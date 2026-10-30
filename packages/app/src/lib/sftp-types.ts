import type { AuthMethod } from "@/lib/server-types"

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

export interface SftpDeletePathsResult {
  mode: "fast" | "recursive_task"
  deleted_paths: string[]
  task_id?: string
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
  sourceCredential?: SftpTransferCredential
  targetCredential?: SftpTransferCredential
  sourceServerName?: string
  targetServerName?: string
  sourceAuthMethod?: SftpAuthMethod
  targetAuthMethod?: SftpAuthMethod
}
