import { isTransferJobSettled, type TransferJob } from "@/lib/transfer-job-types"
import type { DirectTransferOptions } from "@/lib/sftp-types"
import {
  createDownloadTransferTask,
  createServerTransferTask,
  createTransferTaskFromJob,
  createUploadTransferTask,
  mapTransferJobToTaskUpdate,
  type TransferTask,
  type TransferTaskUpdate,
} from "./transfer-tasks"
import {
  appendTransferTask,
  applyTransferTaskUpdate,
  clearSettledTransferTasks,
  findTransferTask,
  getActiveTransferTasks,
  isTransferTaskActiveStatus,
  markTransferTaskCancelled,
  mergeRestoredTransferTasks,
  removeTransferTaskById,
} from "./transfer-controller"
import type { TransferConcurrencyLimiter } from "./transfer-runtime"

export type FileTransferDirectTransferOptions = DirectTransferOptions

/** 宿主启动传输时由控制器提供的上下文。 */
export interface TransferStartOptions {
  /** 控制器生成的任务 ID；桌面直接用作传输任务 ID，Web 由服务端另行分配。 */
  taskId: string
  /** 宿主确定传输任务 ID 后立即回调，此后可查询进度与取消。 */
  onStarted: (jobId: string) => void
  signal: AbortSignal
}

export interface TransferUploadOptions extends TransferStartOptions {
  /** 本机数据发送进度。 */
  onProgress?: (loaded: number, total: number) => void
}

/**
 * 宿主提供的传输能力。所有传输都是可查询的传输任务：启动方法在宿主接收全部输入后返回，
 * 其后的进度、结果与取消都通过任务 ID 完成。
 */
export interface FileTransferSftpApi {
  getTransfer: (id: string) => Promise<TransferJob>
  /** 最近的传输任务，用于页面刷新后恢复未结束的任务。 */
  listTransfers: () => Promise<TransferJob[]>
  cancelTransfer: (id: string) => Promise<unknown>
  uploadFile: (serverId: string, remotePath: string, file: File, options: TransferUploadOptions) => Promise<void>
  downloadFile: (serverId: string, remotePath: string, options: TransferStartOptions) => Promise<void>
  batchDownload: (
    serverId: string,
    remotePaths: string[],
    excludePatterns: string[] | undefined,
    options: TransferStartOptions,
  ) => Promise<void>
  directTransfer: (
    sourceServerId: string,
    sourcePath: string,
    targetServerId: string,
    targetPath: string,
    options: FileTransferDirectTransferOptions & TransferStartOptions,
  ) => Promise<void>
  /** 下载任务完成后把产物交给用户；宿主在任务中已写入本地文件时不提供。 */
  deliverArtifact?: (job: TransferJob) => Promise<void>
}

export type TransferTaskStateUpdater = (
  updater: (tasks: readonly TransferTask[]) => TransferTask[],
) => void

export interface CreateFileTransferControllerOptions {
  api: FileTransferSftpApi
  uploadLimiter: TransferConcurrencyLimiter
  getTasks: () => readonly TransferTask[]
  setTasks: TransferTaskStateUpdater
  /** 进度查询间隔，测试中可调小。 */
  pollIntervalMs?: number
  logWarn?: (message: string, ...args: unknown[]) => void
}

export interface RestoreTransfersOptions {
  shouldSkip?: () => boolean
}

export interface FileTransferController {
  restoreTransfers: (options?: RestoreTransfersOptions) => Promise<void>
  downloadFile: (serverId: string, remotePath: string, fileName?: string) => Promise<void>
  batchDownload: (serverId: string, remotePaths: string[], excludePatterns?: string[]) => Promise<void>
  uploadFile: (
    serverId: string,
    remotePath: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<void>
  cancelTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  clearCompleted: () => void
  clearAll: () => void
  updateTask: (taskId: string, update: TransferTaskUpdate) => void
  directTransfer: (
    sourceServerId: string,
    sourcePath: string,
    targetServerId: string,
    targetPath: string,
    sourceServerName: string,
    targetServerName: string,
    fileName: string,
    options?: FileTransferDirectTransferOptions,
  ) => Promise<void>
  cancelDirectTransfer: (taskId: string) => Promise<void>
}

interface RunningTransfer {
  jobId?: string
  abort: AbortController
}

// 进度查询连续失败达到上限后放弃观察，避免任务被外部删除后无限轮询。
const MAX_POLL_FAILURES = 30

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Transfer aborted", "AbortError"))
    }, { once: true })
  })
}

/** UUID v4；`crypto.randomUUID` 只在安全上下文可用，通过 HTTP 访问的实例需要回退。 */
function newTaskId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createFileTransferController({
  api,
  uploadLimiter,
  getTasks,
  setTasks,
  pollIntervalMs = 1000,
  logWarn = (message, ...args) => console.warn(message, ...args),
}: CreateFileTransferControllerOptions): FileTransferController {
  const running = new Map<string, RunningTransfer>()

  const updateTask = (taskId: string, update: TransferTaskUpdate, mergeProgress = false) => {
    setTasks((prev) => applyTransferTaskUpdate(prev, taskId, update, { mergeProgress }))
  }

  /** 轮询传输任务直到结束，并把进度同步到列表项。 */
  const watchJob = async (taskId: string, jobId: string, signal: AbortSignal): Promise<TransferJob> => {
    let failures = 0
    for (;;) {
      signal.throwIfAborted()
      try {
        const job = await api.getTransfer(jobId)
        failures = 0
        signal.throwIfAborted()
        updateTask(taskId, mapTransferJobToTaskUpdate(job))
        if (isTransferJobSettled(job)) return job
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error
        // 桌面任务在启动调用返回前可能尚未落库，短暂的读取失败继续重试。
        failures += 1
        if (failures >= MAX_POLL_FAILURES) throw error
      }
      await sleep(pollIntervalMs, signal)
    }
  }

  const finishJob = async (job: TransferJob, deliver: boolean) => {
    if (job.status === "completed") {
      if (deliver && api.deliverArtifact) await api.deliverArtifact(job)
      return
    }
    if (job.status === "cancelled") return
    throw new Error(job.error_message || "传输失败")
  }

  /**
   * 运行一次传输：启动后按任务 ID 观察到结束。上传在本机内容全部提交后才开始观察，
   * 避免任务状态覆盖本机发送进度。
   */
  const runTransfer = async (
    task: TransferTask,
    start: (options: TransferStartOptions) => Promise<void>,
    { limitConcurrency = false, watchAfterStart = false, deliver = false } = {},
  ) => {
    const entry: RunningTransfer = { abort: new AbortController() }
    const { signal } = entry.abort
    // 启动失败时停止已开始的观察，不当作用户取消。
    const stopWatching = new AbortController()
    const watchSignal = AbortSignal.any([signal, stopWatching.signal])
    running.set(task.id, entry)
    setTasks((prev) => appendTransferTask(prev, task))

    let release: (() => void) | undefined
    let watching: Promise<TransferJob> | undefined
    try {
      if (limitConcurrency) release = await uploadLimiter.acquire()
      signal.throwIfAborted()

      await start({
        taskId: task.id,
        signal,
        onStarted: (jobId) => {
          entry.jobId = jobId
          if (watchAfterStart || watching) return
          watching = watchJob(task.id, jobId, watchSignal)
          // 结果在启动调用返回后统一等待；先标记已处理，避免启动期间的失败成为未处理拒绝。
          watching.catch(() => undefined)
        },
      })
      release?.()
      release = undefined
      const jobId = entry.jobId ?? task.id
      const job = await (watching ?? watchJob(task.id, jobId, watchSignal))
      await finishJob(job, deliver)
    } catch (error) {
      stopWatching.abort()
      if (signal.aborted || isAbortError(error)) {
        setTasks((prev) => markTransferTaskCancelled(prev, task.id))
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      updateTask(task.id, { status: "failed", error: message || "传输失败" })
      throw error
    } finally {
      release?.()
      running.delete(task.id)
    }
  }

  const cancelTask = (taskId: string) => {
    const task = findTransferTask(getTasks(), taskId)
    const entry = running.get(taskId)
    if (!entry && !isTransferTaskActiveStatus(task?.status)) return

    // 未在本页启动的任务（例如刷新后恢复的）以任务 ID 直接取消。
    const jobId = entry ? entry.jobId : taskId
    entry?.abort.abort()
    setTasks((prev) => markTransferTaskCancelled(prev, taskId))
    if (jobId) {
      void Promise.resolve(api.cancelTransfer(jobId)).catch((error: unknown) => {
        logWarn("[transfer-manager] Failed to cancel transfer:", error)
      })
    }
  }

  const followRestoredJob = (job: TransferJob) => {
    const entry: RunningTransfer = { jobId: job.id, abort: new AbortController() }
    running.set(job.id, entry)
    void watchJob(job.id, job.id, entry.abort.signal)
      .catch((error: unknown) => {
        if (!entry.abort.signal.aborted) logWarn("[transfer-manager] Failed to follow transfer:", error)
      })
      .finally(() => running.delete(job.id))
  }

  return {
    async restoreTransfers({ shouldSkip } = {}) {
      const jobs = await api.listTransfers()
      if (shouldSkip?.()) return

      // 等待本机输入的上传无法在刷新后继续，不再恢复。
      const active = jobs.filter((job) => !isTransferJobSettled(job) && job.stage !== "awaiting_input" && !running.has(job.id))
      if (active.length === 0) return

      setTasks((prev) => mergeRestoredTransferTasks(prev, active.map(createTransferTaskFromJob)))
      active.forEach(followRestoredJob)
    },

    uploadFile(serverId, remotePath, file, onProgress) {
      const task = createUploadTransferTask({ taskId: newTaskId(), fileName: file.name, fileSizeBytes: file.size })
      return runTransfer(task, (options) => api.uploadFile(serverId, remotePath, file, {
        ...options,
        onProgress: (loaded, total) => {
          updateTask(task.id, {
            status: "uploading",
            stage: "http",
            bytesTransferred: loaded,
            progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
          }, true)
          onProgress?.(loaded, total)
        },
      }), { limitConcurrency: true, watchAfterStart: true })
    },

    downloadFile(serverId, remotePath, fileName) {
      const task = createDownloadTransferTask({
        taskId: newTaskId(),
        fileName: fileName || remotePath.split("/").filter(Boolean).pop() || "download",
      })
      return runTransfer(task, (options) => api.downloadFile(serverId, remotePath, options), { deliver: true })
    },

    batchDownload(serverId, remotePaths, excludePatterns) {
      const fileName = remotePaths.length === 1
        ? remotePaths[0]?.split("/").filter(Boolean).pop() || "download"
        : "easyssh-download"
      const task = createDownloadTransferTask({ taskId: newTaskId(), fileName })
      return runTransfer(task, (options) => api.batchDownload(serverId, remotePaths, excludePatterns, options), { deliver: true })
    },

    cancelTask,

    removeTask(taskId) {
      cancelTask(taskId)
      setTasks((prev) => removeTransferTaskById(prev, taskId))
    },

    clearCompleted() {
      setTasks((prev) => clearSettledTransferTasks(prev))
    },

    clearAll() {
      getActiveTransferTasks(getTasks()).forEach((task) => cancelTask(task.id))
      setTasks(() => [])
    },

    updateTask,

    directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, sourceServerName, targetServerName, fileName, options) {
      const task = createServerTransferTask({
        taskId: newTaskId(),
        fileName,
        sourceServer: sourceServerName,
        targetServer: targetServerName,
      })
      return runTransfer(task, (startOptions) => api.directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, {
        ...options,
        sourceServerName: options?.sourceServerName ?? sourceServerName,
        targetServerName: options?.targetServerName ?? targetServerName,
        ...startOptions,
      }))
    },

    async cancelDirectTransfer(taskId) {
      cancelTask(taskId)
    },
  }
}
