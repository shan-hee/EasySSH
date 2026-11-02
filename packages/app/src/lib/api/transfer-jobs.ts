import { apiFetch, getApiUrl, platformRequestHeaders } from "@/lib/api-client"
import { createAccessTicket } from "@/lib/access-ticket"
import { startBrowserDownload } from "@/lib/browser-download"
import { resolveAPIErrorMessage } from "@/lib/api-error"
import type { TransferJob, TransferJobKind, TransferJobListResponse, TransferJobStatistics, TransferJobStatus } from "@/lib/transfer-job-types"

export {
  ACTIVE_TRANSFER_JOB_STATUSES,
  isTransferJobSettled,
  type TransferJob,
  type TransferJobKind,
  type TransferJobListResponse,
  type TransferJobStage,
  type TransferJobStatistics,
  type TransferJobStatus,
} from "@/lib/transfer-job-types"

export interface CreateUploadJobOptions {
  serverId: string
  targetPath: string
  file: File
  name?: string
  description?: string
  retentionDays?: number
  deferStart?: boolean
  /** 上传文件夹：fileName 为文件夹名，内容为文件夹包。 */
  folder?: boolean
  /** 文件夹已存在时写入其中并替换同名文件。 */
  merge?: boolean
}

export interface UploadJobInputOptions {
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

export interface CreateDownloadJobRequest {
  serverId: string
  sourcePaths: string[]
  excludePatterns?: string[]
  name?: string
  description?: string
  retentionDays?: number
}

export interface CreateRelayJobRequest {
  sourceServerId: string
  sourcePath: string
  targetServerId: string
  targetPath: string
  name?: string
  description?: string
}

function rejectUpload(xhr: XMLHttpRequest): Error {
  let detail: unknown = xhr.responseText
  try {
    detail = JSON.parse(xhr.responseText)
  } catch {
    // 非 JSON 错误体按文本保留
  }
  return Object.assign(new Error(resolveAPIErrorMessage(detail, `Upload failed with status ${xhr.status}`)), {
    status: xhr.status,
    detail,
  })
}

/** 以原始字节流提交上传内容；使用 XHR 以获得发送进度。 */
async function sendUploadInput(jobId: string, body: Blob, { onProgress, signal }: UploadJobInputOptions): Promise<TransferJob> {
  const headers = await platformRequestHeaders("PUT")
  signal?.throwIfAborted()
  return new Promise<TransferJob>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    signal?.addEventListener("abort", abort, { once: true })
    const settle = () => signal?.removeEventListener("abort", abort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      settle()
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(rejectUpload(xhr))
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as TransferJob)
      } catch (error) {
        reject(error)
      }
    }
    xhr.onerror = () => {
      settle()
      reject(new Error("Network error during upload"))
    }
    xhr.onabort = () => {
      settle()
      reject(new DOMException("Upload aborted", "AbortError"))
    }

    xhr.open("PUT", getApiUrl(`/transfer-jobs/${encodeURIComponent(jobId)}/input`))
    xhr.withCredentials = true
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
    xhr.send(body)
  })
}

export const transferJobsApi = {
  list(params?: {
    page?: number
    page_size?: number
    kind?: TransferJobKind
    status?: TransferJobStatus
  }): Promise<TransferJobListResponse> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.page_size) query.set("page_size", String(params.page_size))
    if (params?.kind) query.set("kind", params.kind)
    if (params?.status) query.set("status", params.status)
    return apiFetch<TransferJobListResponse>(`/transfer-jobs${query.toString() ? `?${query}` : ""}`)
  },

  getStatistics(): Promise<TransferJobStatistics> {
    return apiFetch<TransferJobStatistics>("/transfer-jobs/statistics")
  },

  getById(id: string): Promise<TransferJob> {
    return apiFetch<TransferJob>(`/transfer-jobs/${encodeURIComponent(id)}`, { retry: false })
  },

  /** 创建等待内容的上传任务；随后用 `uploadInput` 提交文件。 */
  createUpload(options: Omit<CreateUploadJobOptions, "file"> & { fileName: string; fileSize: number }): Promise<TransferJob> {
    return apiFetch<TransferJob>("/transfer-jobs/sftp/upload", {
      method: "POST",
      body: {
        server_id: options.serverId,
        target_path: options.targetPath,
        file_name: options.fileName,
        file_size: options.fileSize,
        name: options.name,
        description: options.description,
        retention_days: options.retentionDays,
        defer_start: options.deferStart,
        folder: options.folder,
        merge: options.merge,
      },
      retry: false,
    })
  },

  uploadInput: sendUploadInput,

  /** 创建上传任务并提交文件内容，例如计划任务的暂存文件。 */
  async createBackgroundUpload(options: CreateUploadJobOptions): Promise<TransferJob> {
    const job = await transferJobsApi.createUpload({ ...options, fileName: options.file.name, fileSize: options.file.size })
    return sendUploadInput(job.id, options.file, {})
  },

  createDownload(request: CreateDownloadJobRequest): Promise<TransferJob> {
    return apiFetch<TransferJob>("/transfer-jobs/sftp/download", {
      method: "POST",
      body: {
        server_id: request.serverId,
        source_paths: request.sourcePaths,
        exclude_patterns: request.excludePatterns,
        name: request.name,
        description: request.description,
        retention_days: request.retentionDays,
      },
      retry: false,
    })
  },

  createRelay(request: CreateRelayJobRequest): Promise<TransferJob> {
    return apiFetch<TransferJob>("/transfer-jobs/sftp/relay", {
      method: "POST",
      body: {
        source_server_id: request.sourceServerId,
        source_path: request.sourcePath,
        target_server_id: request.targetServerId,
        target_path: request.targetPath,
        name: request.name,
        description: request.description,
      },
      retry: false,
    })
  },

  async cancel(id: string): Promise<void> {
    await apiFetch<void>(`/transfer-jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", retry: false })
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/transfer-jobs/${encodeURIComponent(id)}`, { method: "DELETE", retry: false })
  },

  /** 由浏览器原生下载已完成任务的产物。 */
  async downloadArtifact(job: Pick<TransferJob, "id" | "artifact_name" | "file_name">): Promise<void> {
    const ticket = await createAccessTicket({ type: "transfer_artifact", task_id: job.id })
    startBrowserDownload(
      getApiUrl(`/transfer-jobs/${encodeURIComponent(job.id)}/artifact?ticket=${encodeURIComponent(ticket)}`),
      job.artifact_name || job.file_name || undefined,
    )
  },
}
