import type { AuthMethod } from "../../../../src/lib/server-types"

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
  can_read?: boolean
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
  type?: "upload" | "download" | "transfer" | string
  file_name: string
  file_size: number
  server_id?: string
  remote_path?: string
  status: "pending" | "uploading" | "downloading" | "transferring" | "completed" | "failed" | "cancelled"
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

export type SftpAuthMethod = AuthMethod

export interface SftpTransferCredential {
  auth_method: SftpAuthMethod
  secret?: string
  password?: string
  private_key?: string
  private_key_passphrase?: string
}

export interface DirectTransferOptions {
  taskId?: string
  sourceCredential?: SftpTransferCredential
  targetCredential?: SftpTransferCredential
  sourceServerName?: string
  targetServerName?: string
  sourceAuthMethod?: SftpAuthMethod
  targetAuthMethod?: SftpAuthMethod
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
