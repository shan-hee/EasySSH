/** Shell-neutral SFTP file metadata returned by Web or Desktop adapters. */
export interface FileInfo {
  name: string
  path: string
  size: number
  mode: number
  mod_time: string
  is_dir: boolean
  is_link: boolean
  link_target?: string
  permission?: string
}

export interface SftpFileItem {
  name: string
  type: "file" | "directory"
  size: string
  sizeBytes: number
  modified: string
  permissions: string
}

export interface DirectoryListResponse {
  path: string
  files: FileInfo[]
  parent?: string
}

export interface DiskUsageResponse {
  path: string
  total: number
  used: number
  available: number
  usage_percent: number
}

export interface BatchOperationError {
  path: string
  error: string
  message: string
}

export interface BatchDeleteResponse {
  success: string[]
  failed: BatchOperationError[]
  total: number
}

export type SftpBatchDownloadMode = "fast" | "compatible"

export type UploadProgressStage = "http" | "sftp" | "stream"

export interface UploadTaskStatus {
  id: string
  file_name: string
  file_size: number
  server_id?: string
  remote_path?: string
  status: "pending" | "uploading" | "completed" | "failed" | "cancelled"
  stage?: UploadProgressStage
  progress: number
  loaded: number
  total: number
  speed_bps: number
  message?: string
  error?: string
  created_at: string
  started_at?: string
  updated_at: string
  ended_at?: string
}

export interface UploadTaskListResponse {
  tasks: UploadTaskStatus[]
}

export interface TransferResponse {
  success: boolean
  message: string
  bytes_copied: number
  file_name: string
}

export interface DirectTransferResponse {
  success: boolean
  task_id: string
  message: string
}

export interface TransferProgressMessage {
  type: "started" | "progress" | "complete" | "error" | "cancelled"
  task_id: string
  bytes_total: number
  bytes_copied: number
  progress: number
  speed_bps: number
  eta: string
  current_file: string
  files_total: number
  files_completed: number
  message: string
  method: "rsync" | "scp" | "sftp"
}
