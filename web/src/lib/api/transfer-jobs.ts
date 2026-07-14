import { apiFetch, authenticatedFetch, getApiUrl } from "@/lib/api-client"

export type TransferJobKind = "sftp_upload" | "sftp_download" | "sftp_transfer"
export type TransferJobStatus =
  | "created"
  | "staging"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"

export interface TransferJob {
  id: string
  user_id: string
  name: string
  kind: TransferJobKind
  runner: string
  status: TransferJobStatus
  stage: string
  description?: string
  source_server_id?: string
  target_server_id?: string
  source_path: string
  target_path: string
  file_name: string
  artifact_name: string
  artifact_size: number
  artifact_managed: boolean
  artifact_expires_at?: string
  progress: number
  bytes_total: number
  bytes_processed: number
  speed_bps: number
  retry_count: number
  max_retries: number
  scheduled_task_id?: string
  error_message?: string
  detail_json?: string
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export interface TransferJobListResponse {
  jobs: TransferJob[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface TransferJobStatistics {
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  expired: number
  bytes_total: number
  bytes_processed: number
  storage_bytes: number
}

export interface CreateBackgroundUploadOptions {
  serverId: string
  targetPath: string
  file: File
  name?: string
  description?: string
  retentionDays?: number
  deferStart?: boolean
}

export interface CreateBackgroundDownloadRequest {
  server_id: string
  source_path: string
  name?: string
  description?: string
  retention_days?: number
}

async function throwArtifactDownloadError(response: Response): Promise<never> {
  const contentType = response.headers.get("content-type") || ""
  let detail: unknown
  try {
    detail = contentType.includes("application/json")
      ? await response.json()
      : await response.text()
  } catch {
    detail = `download artifact failed: ${response.status}`
  }
  throw Object.assign(new Error(`download artifact failed: ${response.status}`), {
    status: response.status,
    detail,
  })
}

export const transferJobsApi = {
  async list(params?: {
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

  async getStatistics(): Promise<TransferJobStatistics> {
    return apiFetch<TransferJobStatistics>("/transfer-jobs/statistics")
  },

  async getById(id: string): Promise<TransferJob> {
    return apiFetch<TransferJob>(`/transfer-jobs/${encodeURIComponent(id)}`)
  },

  async createBackgroundUpload(options: CreateBackgroundUploadOptions): Promise<TransferJob> {
    const form = new FormData()
    form.set("server_id", options.serverId)
    form.set("target_path", options.targetPath)
    form.set("file_name", options.file.name)
    form.set("file_size", String(options.file.size))
    if (options.name) form.set("name", options.name)
    if (options.description) form.set("description", options.description)
    if (options.retentionDays) form.set("retention_days", String(options.retentionDays))
    if (options.deferStart) form.set("defer_start", "true")
    form.set("file", options.file)

    return apiFetch<TransferJob>("/transfer-jobs/sftp/upload", {
      method: "POST",
      body: form,
      retry: false,
      timeout: 0,
    })
  },

  async createBackgroundDownload(data: CreateBackgroundDownloadRequest): Promise<TransferJob> {
    return apiFetch<TransferJob>("/transfer-jobs/sftp/download", {
      method: "POST",
      body: data,
      retry: false,
      timeout: 30000,
    })
  },

  async cancel(id: string): Promise<void> {
    await apiFetch<void>(`/transfer-jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      retry: false,
    })
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/transfer-jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      retry: false,
    })
  },

  async downloadArtifact(id: string): Promise<Blob> {
    const url = getApiUrl(`/transfer-jobs/${encodeURIComponent(id)}/artifact`)
    const response = await authenticatedFetch(url)
    if (!response.ok) {
      await throwArtifactDownloadError(response)
    }
    return response.blob()
  },
}
