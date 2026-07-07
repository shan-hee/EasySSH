import type { DirectTransferOptions, DirectTransferResponse, FileInfo, SftpBatchDownloadMode, UploadTaskListResponse, UploadTaskStatus } from "./sftp-types"
import {
  createDownloadTransferTask,
  createServerTransferTask,
  createUploadTransferTask,
  mapUploadTaskStatusToTransferTask,
  type TransferTask,
  type TransferTaskUpdate,
} from "./transfer-tasks"
import {
  appendTransferTask,
  applyTransferTaskUpdate,
  clearSettledTransferTasks,
  findTransferTask,
  getActiveTransferTasks,
  getSettledTransferTaskIds,
  getTransferTaskIds,
  markTransferTaskCancelled,
  mergeRestoredTransferTasks,
  removeTransferTaskById,
} from "./transfer-controller"
import {
  bindServerTransferProgressSocket,
  bindUploadTransferProgressSocket,
  cancelTransferRuntimeTask,
  clearTransferRuntimeTaskHandles,
  consumeTransferCancelledBeforeStart,
  createTransferProgressWebSocket,
  createUploadHttpProgressHandler,
  registerTransferWebSocket,
  registerTransferXhr,
  releaseTransferRuntimeTaskHandles,
  waitForTransferWebSocketOpen,
  type ReleaseTransferRuntimeSlot,
  type TransferAuthTicketProvider,
  type TransferConcurrencyLimiter,
  type TransferRuntimeHandleStore,
  type TransferWebSocketConstructor,
  type TransferWebSocketUrlResolver,
} from "./transfer-runtime"

export type FileTransferDirectTransferOptions = DirectTransferOptions

export interface FileTransferSftpApi {
  createUploadTask: () => Promise<{ task_id: string }>
  listUploadTasks: () => Promise<UploadTaskListResponse>
  getUploadTask?: (taskId: string) => Promise<UploadTaskStatus>
  getTransferTask?: (taskId: string) => Promise<UploadTaskStatus>
  cancelUploadTask: (taskId: string) => Promise<unknown>
  downloadFile?: (serverId: string, path: string, taskId?: string) => Promise<void> | void
  batchDownload?: (
    serverId: string,
    paths: string[],
    mode?: SftpBatchDownloadMode,
    excludePatterns?: string[],
    taskId?: string,
  ) => Promise<void>
  uploadFile: (
    serverId: string,
    path: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    wsTaskId?: string,
    onXhr?: (xhr: XMLHttpRequest) => void,
  ) => Promise<FileInfo | null>
  directTransfer: (
    sourceServerId: string,
    sourcePath: string,
    targetServerId: string,
    targetPath: string,
    options?: FileTransferDirectTransferOptions,
  ) => Promise<DirectTransferResponse>
  cancelTransfer: (taskId: string) => Promise<unknown>
}

export type TransferTaskStateUpdater = (
  updater: (tasks: readonly TransferTask[]) => TransferTask[],
) => void

export interface CreateFileTransferControllerOptions {
  api: FileTransferSftpApi
  createTicket: TransferAuthTicketProvider
  resolveWebSocketUrl: TransferWebSocketUrlResolver
  uploadLimiter: TransferConcurrencyLimiter
  handles: TransferRuntimeHandleStore
  getTasks: () => readonly TransferTask[]
  setTasks: TransferTaskStateUpdater
  serverTransferUsesProgressSocket?: boolean
  WebSocketCtor?: TransferWebSocketConstructor
  logError?: (message: string, error?: unknown) => void
  logWarn?: (message: string, ...args: unknown[]) => void
}

export interface RestoreUploadTasksOptions {
  shouldSkip?: () => boolean
}

export interface FileTransferController {
  restoreUploadTasks: (options?: RestoreUploadTasksOptions) => Promise<void>
  downloadFile: (serverId: string, remotePath: string, fileName?: string) => Promise<void>
  batchDownload: (
    serverId: string,
    remotePaths: string[],
    mode?: SftpBatchDownloadMode,
    excludePatterns?: string[],
  ) => Promise<void>
  uploadFile: (
    serverId: string,
    remotePath: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    enableWebSocket?: boolean,
  ) => Promise<FileInfo | null>
  cancelTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  clearCompleted: () => void
  clearAll: () => void
  createTransferTask: (fileName: string, sourceServer: string, targetServer: string) => TransferTask
  addTask: (task: TransferTask) => void
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

export function createFileTransferController({
  api,
  createTicket,
  resolveWebSocketUrl,
  uploadLimiter,
  handles,
  getTasks,
  setTasks,
  serverTransferUsesProgressSocket = true,
  WebSocketCtor,
  logError = (message, error) => console.error(message, error),
  logWarn = (message, ...args) => console.warn(message, ...args),
}: CreateFileTransferControllerOptions): FileTransferController {
  const runtimeLogError = (message: string, error?: unknown) => {
    logError(message.replace("[transfer-runtime]", "[transfer-manager]"), error)
  }
  const runtimeLogWarn = (message: string, ...args: unknown[]) => {
    logWarn(message.replace("[transfer-runtime]", "[transfer-manager]"), ...args)
  }
  const isTransferCancellationMessage = (message: string) => {
    const normalizedMessage = message.toLowerCase()
    return (
      message === "Upload aborted" ||
      normalizedMessage.includes("upload cancelled") ||
      normalizedMessage.includes("transfer cancelled") ||
      normalizedMessage.includes("cancelled") ||
      normalizedMessage.includes("canceled") ||
      message.includes("已取消") ||
      message.includes("取消")
    )
  }
  const updateTaskProgress = (taskId: string, update: TransferTaskUpdate) => {
    setTasks((prev) => applyTransferTaskUpdate(prev, taskId, update, { mergeProgress: true }))
  }
  const updateTask = (taskId: string, update: TransferTaskUpdate) => {
    setTasks((prev) => applyTransferTaskUpdate(prev, taskId, update))
  }

  const cancelTask = (taskId: string) => {
    const task = findTransferTask(getTasks(), taskId)
    void cancelTransferRuntimeTask({
      handles,
      taskId,
      task,
      cancelUploadTask: api.cancelUploadTask,
      cancelServerTransfer: api.cancelTransfer,
      markCancelled: (cancelledTaskId) => {
        setTasks((prev) => markTransferTaskCancelled(prev, cancelledTaskId))
      },
      logError: runtimeLogError,
    })
  }
  const startTaskPolling = (
    taskId: string,
    fileSizeBytes: number,
    readStatus?: (taskId: string) => Promise<UploadTaskStatus>,
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    if (!readStatus) {
      return () => undefined
    }

    let stopped = false
    let inFlight = false
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const poll = async () => {
      if (stopped || inFlight) {
        return
      }

      inFlight = true
      try {
        const status = await readStatus(taskId)
        if (stopped) {
          return
        }

        const currentTask = findTransferTask(getTasks(), taskId)
        if (currentTask?.status === "completed" || currentTask?.status === "failed" || currentTask?.status === "cancelled") {
          stop()
          return
        }
        const mapped = mapUploadTaskStatusToTransferTask(status, currentTask?.startTime)
        updateTaskProgress(taskId, {
          fileName: mapped.fileName,
          fileSize: mapped.fileSize,
          fileSizeBytes: mapped.fileSizeBytes || fileSizeBytes,
          progress: mapped.progress,
          status: mapped.status,
          speed: mapped.speed,
          timeRemaining: mapped.timeRemaining,
          error: mapped.error,
          bytesTransferred: mapped.bytesTransferred,
          stage: mapped.stage,
        })

        const total = status.total || status.file_size || fileSizeBytes
        if (total > 0) {
          onProgress?.(status.loaded || 0, total)
        }
        if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
          stop()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.toLowerCase().includes("task not found")) {
          logWarn("[transfer-manager] Failed to poll transfer task:", error)
        }
      } finally {
        inFlight = false
      }
    }

    timer = setInterval(() => {
      void poll()
    }, 500)
    void poll()
    return stop
  }

  return {
    async restoreUploadTasks({ shouldSkip } = {}) {
      const response = await api.listUploadTasks()
      if (shouldSkip?.()) {
        return
      }

      const uploadTasks = response.tasks
        .filter((task) => task.status === "pending" || task.status === "uploading")
        .map((task) => mapUploadTaskStatusToTransferTask(task))
      if (uploadTasks.length === 0) {
        return
      }

      setTasks((prev) => mergeRestoredTransferTasks(prev, uploadTasks))
    },

    async uploadFile(serverId, remotePath, file, onProgress, enableWebSocket) {
      const created = await api.createUploadTask()
      const taskId = created.task_id
      const task = createUploadTransferTask({
        taskId,
        fileName: file.name,
        fileSizeBytes: file.size,
      })
      setTasks((prev) => appendTransferTask(prev, task))

      let releaseSlot: ReleaseTransferRuntimeSlot | null = null
      try {
        releaseSlot = await uploadLimiter.acquire()
      } catch (error) {
        void error
      }

      if (consumeTransferCancelledBeforeStart(handles, task.id)) {
        updateTaskProgress(task.id, {
          status: "cancelled",
          error: "已取消",
        })
        releaseSlot?.()
        return null
      }

      let wsConnection: WebSocket | null = null
      let stopPolling: (() => void) | null = null
      try {
        if (enableWebSocket) {
          try {
            wsConnection = await createTransferProgressWebSocket({
              kind: "upload",
              taskId: task.id,
              createTicket,
              resolveWebSocketUrl,
              WebSocketCtor,
            })
            registerTransferWebSocket(handles, task.id, wsConnection)
          } catch (error) {
            logWarn("[transfer-manager] Failed to create upload WS ticket, fallback to non-WS upload:", error)
          }

          if (wsConnection) {
            bindUploadTransferProgressSocket({
              socket: wsConnection,
              taskId: task.id,
              fileSizeBytes: file.size,
              onTaskUpdate: updateTaskProgress,
              onProgress,
              logError: runtimeLogError,
            })
            await waitForTransferWebSocketOpen(wsConnection, { timeoutMs: 2000 })
          }
        }
        if (!wsConnection) {
          stopPolling = startTaskPolling(task.id, file.size, api.getUploadTask, onProgress)
        }

        const fileInfo = await api.uploadFile(
          serverId,
          remotePath,
          file,
          createUploadHttpProgressHandler({
            taskId: task.id,
            fileSizeBytes: file.size,
            onTaskUpdate: updateTaskProgress,
            onProgress,
          }),
          task.id,
          (xhr) => {
            registerTransferXhr(handles, task.id, xhr)
          },
        )

        updateTaskProgress(task.id, {
          progress: 100,
          status: "completed",
          bytesTransferred: file.size,
          stage: "stream",
        })
        return fileInfo ?? null
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const isAborted = isTransferCancellationMessage(message)

        updateTaskProgress(task.id, {
          status: isAborted ? "cancelled" : "failed",
          error: isAborted ? "已取消" : message || "上传失败",
        })

        if (isAborted) {
          return null
        }
        throw error
      } finally {
        stopPolling?.()
        releaseSlot?.()
        releaseTransferRuntimeTaskHandles(handles, task.id, {
          closeWebSocket: !!wsConnection,
          includeConnecting: true,
        })
      }
    },

    async downloadFile(serverId, remotePath, fileName) {
      if (!api.downloadFile) {
        return
      }

      if (!api.getTransferTask) {
        await api.downloadFile(serverId, remotePath)
        return
      }

      const taskId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      const task = createDownloadTransferTask({
        taskId,
        fileName: fileName || remotePath.split("/").filter(Boolean).pop() || "download",
      })
      setTasks((prev) => appendTransferTask(prev, task))

      let stopPolling: (() => void) | null = null
      try {
        stopPolling = startTaskPolling(task.id, task.fileSizeBytes, api.getTransferTask)
        await api.downloadFile(serverId, remotePath, task.id)
        updateTaskProgress(task.id, {
          progress: 100,
          status: "completed",
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const isCancelled = isTransferCancellationMessage(message)
        updateTaskProgress(task.id, {
          status: isCancelled ? "cancelled" : "failed",
          error: isCancelled ? "已取消" : message || "下载失败",
        })
        if (isCancelled) {
          return
        }
        throw error
      } finally {
        stopPolling?.()
        releaseTransferRuntimeTaskHandles(handles, task.id)
      }
    },

    async batchDownload(serverId, remotePaths, mode, excludePatterns) {
      if (!api.batchDownload) {
        return
      }

      if (!api.getTransferTask) {
        await api.batchDownload(serverId, remotePaths, mode, excludePatterns)
        return
      }

      const extension = mode === "fast" ? "tar.gz" : "zip"
      const fileName = remotePaths.length === 1
        ? `${remotePaths[0]?.split("/").filter(Boolean).pop() || "download"}.${extension}`
        : `easyssh-download.${extension}`
      const taskId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      const task = createDownloadTransferTask({
        taskId,
        fileName,
      })
      setTasks((prev) => appendTransferTask(prev, task))

      let stopPolling: (() => void) | null = null
      try {
        stopPolling = startTaskPolling(task.id, task.fileSizeBytes, api.getTransferTask)
        await api.batchDownload(serverId, remotePaths, mode, excludePatterns, task.id)
        updateTaskProgress(task.id, {
          progress: 100,
          status: "completed",
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const isCancelled = isTransferCancellationMessage(message)
        updateTaskProgress(task.id, {
          status: isCancelled ? "cancelled" : "failed",
          error: isCancelled ? "已取消" : message || "下载失败",
        })
        if (isCancelled) {
          return
        }
        throw error
      } finally {
        stopPolling?.()
        releaseTransferRuntimeTaskHandles(handles, task.id)
      }
    },

    cancelTask,

    removeTask(taskId) {
      cancelTask(taskId)
      setTasks((prev) => removeTransferTaskById(prev, taskId))
    },

    clearCompleted() {
      const completedTaskIds = getSettledTransferTaskIds(getTasks())
      clearTransferRuntimeTaskHandles(handles, {
        taskIds: completedTaskIds,
        abortXhrs: false,
      })
      setTasks((prev) => clearSettledTransferTasks(prev))
    },

    clearAll() {
      const tasks = getTasks()
      const activeTasks = getActiveTransferTasks(tasks)
      activeTasks.forEach((task) => {
        void cancelTransferRuntimeTask({
          handles,
          taskId: task.id,
          task,
          cancelUploadTask: api.cancelUploadTask,
          cancelServerTransfer: api.cancelTransfer,
          closeWebSocket: true,
          logError: runtimeLogError,
        })
      })
      clearTransferRuntimeTaskHandles(handles, {
        taskIds: getTransferTaskIds(tasks),
        clearCancellationMarkers: false,
      })
      setTasks(() => [])
    },

    createTransferTask(fileName, sourceServer, targetServer) {
      return createServerTransferTask({
        fileName,
        sourceServer,
        targetServer,
      })
    },

    addTask(task) {
      setTasks((prev) => appendTransferTask(prev, task))
    },

    updateTask,

    async directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, sourceServerName, targetServerName, fileName, options) {
      const localTask = createServerTransferTask({
        taskId: !serverTransferUsesProgressSocket ? options?.taskId : undefined,
        fileName,
        sourceServer: sourceServerName,
        targetServer: targetServerName,
      })
      if (!serverTransferUsesProgressSocket) {
        setTasks((prev) => appendTransferTask(prev, localTask))
      }

      let started: DirectTransferResponse
      let stopPolling: (() => void) | null = null
      try {
        if (!serverTransferUsesProgressSocket) {
          stopPolling = startTaskPolling(localTask.id, 0, api.getTransferTask)
        }
        started = await api.directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, {
          ...options,
          taskId: serverTransferUsesProgressSocket ? options?.taskId : options?.taskId ?? localTask.id,
          sourceServerName: options?.sourceServerName ?? sourceServerName,
          targetServerName: options?.targetServerName ?? targetServerName,
        })
      } catch (error: unknown) {
        if (!serverTransferUsesProgressSocket) {
          const message = error instanceof Error ? error.message : String(error)
          const isCancelled = isTransferCancellationMessage(message)
          updateTask(localTask.id, {
            status: isCancelled ? "cancelled" : "failed",
            error: isCancelled ? "已取消" : message || "传输失败",
          })
          if (isCancelled) {
            return
          }
        }
        throw error
      } finally {
        stopPolling?.()
      }
      const taskId = started.task_id
      const task = createServerTransferTask({
        taskId,
        fileName,
        sourceServer: sourceServerName,
        targetServer: targetServerName,
      })
      if (serverTransferUsesProgressSocket) {
        setTasks((prev) => appendTransferTask(prev, task))
      }

      if (!serverTransferUsesProgressSocket) {
        setTasks((prev) => {
          const replaced = prev.map((item) => (
            item.id === localTask.id
              ? {
                  ...item,
                  id: taskId,
                  progress: 100,
                  status: "completed" as const,
                  transferMethod: "sftp" as const,
                }
              : item
          ))
          return replaced.some((item) => item.id === taskId) ? replaced : appendTransferTask(replaced, {
            ...task,
            progress: 100,
            status: "completed",
            transferMethod: "sftp",
          })
        })
        return
      }

      let wsConnection: WebSocket | null = null
      let isTransferFinished = () => false

      try {
        wsConnection = await createTransferProgressWebSocket({
          kind: "serverTransfer",
          taskId,
          createTicket,
          resolveWebSocketUrl,
          WebSocketCtor,
        })
        registerTransferWebSocket(handles, taskId, wsConnection)

        const transferWatcher = bindServerTransferProgressSocket({
          socket: wsConnection,
          taskId,
          handles,
          onTaskUpdate: updateTask,
          onUnexpectedClose: (closedTaskId) => {
            setTasks((prev) => {
              const currentTask = findTransferTask(prev, closedTaskId)
              if (currentTask && currentTask.status === "transferring") {
                return applyTransferTaskUpdate(prev, closedTaskId, {
                  status: "failed",
                  error: "连接断开",
                })
              }
              return [...prev]
            })
          },
          logError: runtimeLogError,
          logWarn: runtimeLogWarn,
        })
        isTransferFinished = transferWatcher.isTransferFinished

        await waitForTransferWebSocketOpen(wsConnection, {
          timeoutMs: 5000,
          rejectOnError: true,
        })
        await transferWatcher.completion
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const isCancelled = isTransferCancellationMessage(message)

        if (!isCancelled && !isTransferFinished()) {
          updateTask(taskId, {
            status: "failed",
            error: message || "传输失败",
          })
          throw error
        }
      } finally {
        if (wsConnection) {
          releaseTransferRuntimeTaskHandles(handles, taskId, {
            closeWebSocket: true,
            includeConnecting: true,
          })
        }
      }
    },

    async cancelDirectTransfer(taskId) {
      const task = findTransferTask(getTasks(), taskId)
      await cancelTransferRuntimeTask({
        handles,
        taskId,
        task: task ?? { id: taskId, type: "transfer", status: "transferring" },
        cancelServerTransfer: api.cancelTransfer,
        markCancelled: (cancelledTaskId) => {
          updateTask(cancelledTaskId, {
            status: "cancelled",
            error: "已取消",
          })
        },
        logError: runtimeLogError,
      })
    },
  }
}
