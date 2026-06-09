import { sftpApi } from "@/lib/api/sftp"
import type { DirectTransferOptions, DirectTransferResponse, FileInfo, UploadTaskListResponse } from "@/lib/sftp-types"
import type { TerminalAuthMethod, TerminalAuthPrompt, TerminalAuthResponsePayload } from "@/lib/websocket-terminal"
import type { SftpDirectoryApi } from "./sftp-directory"
import type { SftpOperationsApi } from "./sftp-operations"

export type SftpBatchDownloadMode = "fast" | "compatible"

export type SftpSessionDirectTransferOptions = DirectTransferOptions

export interface SftpSessionApi extends SftpDirectoryApi, SftpOperationsApi {
  authenticate?: (
    serverId: string,
    authMethod: TerminalAuthMethod,
    secret: string,
    privateKeyPassphrase?: string,
    options?: {
      password?: string
      privateKey?: string
    },
  ) => Promise<unknown>
  preAuthenticate?: (
    serverId: string,
    credential: {
      authMethod?: TerminalAuthMethod
      password?: string
      privateKey?: string
      secret?: string
      privateKeyPassphrase?: string
    },
    onAuthPrompt: (
      prompt: TerminalAuthPrompt,
      respond: (response: string[] | TerminalAuthResponsePayload, cancelled?: boolean, authMethod?: TerminalAuthMethod) => void,
    ) => void,
  ) => Promise<unknown>
  downloadFile: (serverId: string, path: string) => Promise<void> | void
  readFile: (serverId: string, path: string) => Promise<string>
  batchDownload: (
    serverId: string,
    paths: string[],
    mode?: SftpBatchDownloadMode,
    excludePatterns?: string[],
  ) => Promise<void>
  chmod?: (serverId: string, path: string, mode: string) => Promise<unknown>
  closeConnection?: (serverId: string) => Promise<unknown>
  createUploadTask?: () => Promise<{ task_id: string }>
  listUploadTasks?: () => Promise<UploadTaskListResponse>
  cancelUploadTask?: (taskId: string) => Promise<unknown>
  uploadFile?: (
    serverId: string,
    path: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    wsTaskId?: string,
    onXhr?: (xhr: XMLHttpRequest) => void,
  ) => Promise<FileInfo | null>
  directTransfer?: (
    sourceServerId: string,
    sourcePath: string,
    targetServerId: string,
    targetPath: string,
    options?: SftpSessionDirectTransferOptions,
  ) => Promise<DirectTransferResponse>
  cancelTransfer?: (taskId: string) => Promise<unknown>
  uploadUsesProgressSocket?: boolean
  serverTransferUsesProgressSocket?: boolean
}

export type SftpSessionApiAdapter = Partial<SftpSessionApi>

export const defaultSftpSessionApi: SftpSessionApi = sftpApi

export function createSftpSessionApi(adapter?: SftpSessionApiAdapter): SftpSessionApi {
  if (!adapter) {
    return defaultSftpSessionApi
  }

  const definedAdapter: SftpSessionApiAdapter = {}

  if (adapter.authenticate) definedAdapter.authenticate = adapter.authenticate
  if (adapter.preAuthenticate) definedAdapter.preAuthenticate = adapter.preAuthenticate
  if (adapter.listDirectory) definedAdapter.listDirectory = adapter.listDirectory
  if (adapter.delete) definedAdapter.delete = adapter.delete
  if (adapter.createDirectory) definedAdapter.createDirectory = adapter.createDirectory
  if (adapter.writeFile) definedAdapter.writeFile = adapter.writeFile
  if (adapter.rename) definedAdapter.rename = adapter.rename
  if (adapter.batchDelete) definedAdapter.batchDelete = adapter.batchDelete
  if (adapter.downloadFile) definedAdapter.downloadFile = adapter.downloadFile
  if (adapter.readFile) definedAdapter.readFile = adapter.readFile
  if (adapter.batchDownload) definedAdapter.batchDownload = adapter.batchDownload
  if (adapter.chmod) definedAdapter.chmod = adapter.chmod
  if (adapter.closeConnection) definedAdapter.closeConnection = adapter.closeConnection
  if (adapter.createUploadTask) definedAdapter.createUploadTask = adapter.createUploadTask
  if (adapter.listUploadTasks) definedAdapter.listUploadTasks = adapter.listUploadTasks
  if (adapter.cancelUploadTask) definedAdapter.cancelUploadTask = adapter.cancelUploadTask
  if (adapter.uploadFile) definedAdapter.uploadFile = adapter.uploadFile
  if (adapter.directTransfer) definedAdapter.directTransfer = adapter.directTransfer
  if (adapter.cancelTransfer) definedAdapter.cancelTransfer = adapter.cancelTransfer
  if (typeof adapter.uploadUsesProgressSocket === "boolean") {
    definedAdapter.uploadUsesProgressSocket = adapter.uploadUsesProgressSocket
  }
  if (typeof adapter.serverTransferUsesProgressSocket === "boolean") {
    definedAdapter.serverTransferUsesProgressSocket = adapter.serverTransferUsesProgressSocket
  }

  return {
    ...defaultSftpSessionApi,
    ...definedAdapter,
  }
}
