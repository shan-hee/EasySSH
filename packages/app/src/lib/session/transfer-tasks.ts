import { isTransferJobSettled, type TransferJob } from "@/lib/transfer-job-types"
import { formatBytesString, formatRemainingTime, formatSpeed } from "@/utils/format"
import type { WorkspaceTransferTask } from "./workspace"

export type TransferTask = WorkspaceTransferTask

export type TransferTaskUpdate = Partial<WorkspaceTransferTask>

export interface CreateUploadTransferTaskOptions {
  taskId: string
  fileName: string
  fileSizeBytes: number
  startTime?: number
}

export interface CreateServerTransferTaskOptions {
  taskId: string
  fileName: string
  sourceServer: string
  targetServer: string
  startTime?: number
}

export interface CreateDownloadTransferTaskOptions {
  taskId: string
  fileName: string
  fileSizeBytes?: number
  startTime?: number
}

export function createUploadTransferTask({
  taskId,
  fileName,
  fileSizeBytes,
  startTime = Date.now(),
}: CreateUploadTransferTaskOptions): WorkspaceTransferTask {
  return {
    id: taskId,
    fileName,
    fileSize: formatBytesString(fileSizeBytes),
    fileSizeBytes,
    progress: 0,
    status: "pending",
    type: "upload",
    startTime,
    bytesTransferred: 0,
  }
}

export function createServerTransferTask({
  taskId,
  fileName,
  sourceServer,
  targetServer,
  startTime = Date.now(),
}: CreateServerTransferTaskOptions): WorkspaceTransferTask {
  return {
    id: taskId,
    fileName,
    fileSize: "-",
    fileSizeBytes: 0,
    progress: 0,
    status: "pending",
    type: "transfer",
    startTime,
    sourceServer,
    targetServer,
  }
}

export function createDownloadTransferTask({
  taskId,
  fileName,
  fileSizeBytes = 0,
  startTime = Date.now(),
}: CreateDownloadTransferTaskOptions): WorkspaceTransferTask {
  return {
    id: taskId,
    fileName,
    fileSize: fileSizeBytes > 0 ? formatBytesString(fileSizeBytes) : "-",
    fileSizeBytes,
    progress: 0,
    status: "pending",
    type: "download",
    startTime,
    bytesTransferred: 0,
  }
}

const TRANSFER_JOB_TYPES: Record<TransferJob["kind"], WorkspaceTransferTask["type"]> = {
  sftp_upload: "upload",
  sftp_download: "download",
  sftp_transfer: "transfer",
}

const ACTIVE_STATUS_BY_TYPE: Record<WorkspaceTransferTask["type"], WorkspaceTransferTask["status"]> = {
  upload: "uploading",
  download: "downloading",
  transfer: "transferring",
}

function transferJobStage(stage: TransferJob["stage"]): WorkspaceTransferTask["stage"] {
  switch (stage) {
    case "awaiting_input":
    case "staging":
      return "http"
    case "transfer_to_remote":
    case "download_from_remote":
      return "sftp"
    default:
      return "stream"
  }
}

function transferJobStatus(job: TransferJob): WorkspaceTransferTask["status"] {
  switch (job.status) {
    case "completed":
    case "failed":
    case "cancelled":
      return job.status
    case "created":
    case "queued":
      return "pending"
    default:
      return ACTIVE_STATUS_BY_TYPE[TRANSFER_JOB_TYPES[job.kind]]
  }
}

/** 由服务端或桌面的传输任务得到列表项的进度更新。 */
export function mapTransferJobToTaskUpdate(job: TransferJob): TransferTaskUpdate {
  const total = job.bytes_total
  const processed = job.bytes_processed
  const settled = isTransferJobSettled(job)
  return {
    status: transferJobStatus(job),
    progress: job.status === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(job.progress))),
    bytesTransferred: processed,
    ...(total > 0 ? { fileSizeBytes: total, fileSize: formatBytesString(total) } : {}),
    speed: !settled && job.speed_bps > 0 ? formatSpeed(job.speed_bps) : undefined,
    timeRemaining: !settled && job.speed_bps > 0 && total > processed
      ? formatRemainingTime((total - processed) / job.speed_bps)
      : undefined,
    error: job.error_message || undefined,
    stage: transferJobStage(job.stage),
  }
}

/** 页面刷新后从未结束的传输任务恢复列表项。 */
export function createTransferTaskFromJob(job: TransferJob): WorkspaceTransferTask {
  const startedAt = Date.parse(job.started_at || job.created_at)
  const task: WorkspaceTransferTask = {
    id: job.id,
    fileName: job.file_name || job.name || job.source_path.split("/").filter(Boolean).pop() || job.id,
    fileSize: "-",
    fileSizeBytes: 0,
    progress: 0,
    status: "pending",
    type: TRANSFER_JOB_TYPES[job.kind],
    startTime: Number.isFinite(startedAt) ? startedAt : Date.now(),
  }
  return { ...task, ...mapTransferJobToTaskUpdate(job) }
}

export function mergeTransferTaskUpdate(
  task: WorkspaceTransferTask,
  update: TransferTaskUpdate,
  now: number = Date.now(),
): WorkspaceTransferTask {
  const stageChanged = update.stage !== undefined && update.stage !== task.stage
  const updatedTask: WorkspaceTransferTask = {
    ...task,
    ...update,
    // 阶段切换时重置计时起点，避免本地发送与远端写入阶段混算平均速度。
    startTime: stageChanged ? now : task.startTime,
  }

  if (updatedTask.bytesTransferred !== undefined && updatedTask.startTime) {
    const elapsedSeconds = (now - updatedTask.startTime) / 1000
    if (elapsedSeconds > 0) {
      const speed = updatedTask.bytesTransferred / elapsedSeconds
      updatedTask.speed = formatSpeed(speed)

      const remainingBytes = Math.max(0, updatedTask.fileSizeBytes - updatedTask.bytesTransferred)
      if (speed > 0) {
        updatedTask.timeRemaining = formatRemainingTime(remainingBytes / speed)
      }
    }
  }

  return updatedTask
}
