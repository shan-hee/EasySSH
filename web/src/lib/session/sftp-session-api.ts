import { sftpApi } from "@/lib/api/sftp"
import type { DirectTransferOptions, DirectTransferResponse, DiskUsageResponse, FileInfo, UploadTaskListResponse, UploadTaskStatus } from "@/lib/sftp-types"
import type {
  TerminalAuthMethod,
  TerminalAuthPrompt,
  TerminalAuthResponsePayload,
  TerminalHostKeyPrompt,
  TerminalHostKeyResponder,
} from "@/lib/websocket-terminal"
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
    onHostKeyPrompt?: (
      prompt: TerminalHostKeyPrompt,
      respond: TerminalHostKeyResponder,
    ) => void,
  ) => Promise<unknown>
  getFileInfo?: (serverId: string, path: string) => Promise<FileInfo>
  getDiskUsage?: (serverId: string, path?: string) => Promise<DiskUsageResponse>
  downloadFile: (serverId: string, path: string, taskId?: string) => Promise<void> | void
  readFile: (serverId: string, path: string) => Promise<string>
  batchDownload: (
    serverId: string,
    paths: string[],
    mode?: SftpBatchDownloadMode,
    excludePatterns?: string[],
    taskId?: string,
  ) => Promise<void>
  chmod?: (serverId: string, path: string, mode: string) => Promise<unknown>
  closeConnection?: (serverId: string) => Promise<unknown>
  createUploadTask?: () => Promise<{ task_id: string }>
  listUploadTasks?: () => Promise<UploadTaskListResponse>
  getUploadTask?: (taskId: string) => Promise<UploadTaskStatus>
  getTransferTask?: (taskId: string) => Promise<UploadTaskStatus>
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

const completeSftpSessionApiMethods = [
  "authenticate",
  "preAuthenticate",
  "getFileInfo",
  "getDiskUsage",
  "listDirectory",
  "delete",
  "deletePaths",
  "createDirectory",
  "writeFile",
  "rename",
  "batchDelete",
  "downloadFile",
  "readFile",
  "batchDownload",
  "chmod",
  "closeConnection",
  "createUploadTask",
  "listUploadTasks",
  "getUploadTask",
  "getTransferTask",
  "cancelUploadTask",
  "uploadFile",
  "directTransfer",
  "cancelTransfer",
] as const satisfies readonly (keyof SftpSessionApi)[]

export type CompleteSftpSessionApi = SftpSessionApi & Required<Pick<
  SftpSessionApi,
  (typeof completeSftpSessionApiMethods)[number]
>>

export function assertCompleteSftpSessionApi(
  adapter: SftpSessionApiAdapter | undefined,
  context: string,
): asserts adapter is CompleteSftpSessionApi {
  const missingMethods = completeSftpSessionApiMethods.filter((method) => (
    typeof adapter?.[method] !== "function"
  ))

  if (missingMethods.length > 0) {
    throw new Error(`${context} requires a complete SFTP api adapter: ${missingMethods.join(", ")}`)
  }
}

export function createSftpSessionApi(adapter?: SftpSessionApiAdapter): SftpSessionApi {
  if (!adapter) {
    return defaultSftpSessionApi
  }

  const definedAdapter: SftpSessionApiAdapter = {}

  if (adapter.authenticate) definedAdapter.authenticate = adapter.authenticate
  if (adapter.preAuthenticate) definedAdapter.preAuthenticate = adapter.preAuthenticate
  if (adapter.getFileInfo) definedAdapter.getFileInfo = adapter.getFileInfo
  if (adapter.getDiskUsage) definedAdapter.getDiskUsage = adapter.getDiskUsage
  if (adapter.listDirectory) definedAdapter.listDirectory = adapter.listDirectory
  if (adapter.delete) definedAdapter.delete = adapter.delete
  if (adapter.deletePaths) definedAdapter.deletePaths = adapter.deletePaths
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
  if (adapter.getUploadTask) definedAdapter.getUploadTask = adapter.getUploadTask
  if (adapter.getTransferTask) definedAdapter.getTransferTask = adapter.getTransferTask
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
