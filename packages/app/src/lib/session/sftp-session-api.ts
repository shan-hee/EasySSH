import { sftpApi } from "@/lib/api/sftp"
import type { DiskUsageResponse, FileInfo } from "@/lib/sftp-types"
import type {
  TerminalAuthMethod,
  TerminalAuthPrompt,
  TerminalAuthResponsePayload,
  TerminalHostKeyPrompt,
  TerminalHostKeyResponder,
} from "@/lib/websocket-terminal"
import type { SftpDirectoryApi } from "./sftp-directory"
import type { SftpOperationsApi } from "./sftp-operations"
import type { FileTransferSftpApi } from "./transfer-manager-controller"

/** 文件会话所需的全部能力：目录、文件操作与传输任务。 */
export interface SftpSessionApi extends SftpDirectoryApi, SftpOperationsApi, FileTransferSftpApi {
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
  readFile: (serverId: string, path: string) => Promise<string>
  chmod?: (serverId: string, path: string, mode: string) => Promise<unknown>
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
  "readFile",
  "chmod",
  "getTransfer",
  "listTransfers",
  "cancelTransfer",
  "uploadFile",
  "downloadFile",
  "batchDownload",
  "directTransfer",
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

  // 只覆盖宿主实际提供的方法，未提供的沿用实例接口。
  const definedAdapter = Object.fromEntries(
    Object.entries(adapter).filter(([, value]) => value !== undefined),
  ) as SftpSessionApiAdapter

  return {
    ...defaultSftpSessionApi,
    ...definedAdapter,
  }
}
