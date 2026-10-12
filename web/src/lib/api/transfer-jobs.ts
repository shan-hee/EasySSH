
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

export const transferJobsApi = {
  async list(_params?: {
    page?: number
    page_size?: number
    kind?: TransferJobKind
    status?: TransferJobStatus
  }): Promise<TransferJobListResponse> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async getStatistics(): Promise<TransferJobStatistics> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async getById(_id: string): Promise<TransferJob> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async createBackgroundUpload(_options: CreateBackgroundUploadOptions): Promise<TransferJob> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async createBackgroundDownload(_data: CreateBackgroundDownloadRequest): Promise<TransferJob> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async cancel(_id: string): Promise<void> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async delete(_id: string): Promise<void> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },

  async downloadArtifact(_id: string): Promise<Blob> { throw new Error("浏览器不提供服务端后台任务；请使用当前连接内的操作") },
}
