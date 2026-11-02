import { apiFetch, getWebSocketUrl } from "@/lib/api-client"
import { createAccessTicket } from "@/lib/access-ticket"
import { connectionHeader, withServerConnection } from "@/lib/api/connections"
import { transferJobsApi } from "@/lib/api/transfer-jobs"
import { createFolderBundle } from "@/lib/folder-upload"
import type { FileTransferSftpApi } from "@/lib/session/transfer-manager-controller"
import type {
  TerminalAuthMethod,
  TerminalAuthPrompt,
  TerminalAuthResponsePayload,
  TerminalHostKeyPrompt,
  TerminalHostKeyResponder,
} from "@/lib/websocket-terminal"
import type {
  BatchDeleteResponse,
  DirectoryListResponse,
  DiskUsageResponse,
  FileInfo,
  SftpDeletePathsResult,
} from "@/lib/sftp-types"

export type {
  BatchDeleteResponse,
  BatchOperationError,
  DirectoryListResponse,
  DiskUsageResponse,
  FileInfo,
} from "@/lib/sftp-types"

type ApiFetchOptions = NonNullable<Parameters<typeof apiFetch>[1]>

/** 文件请求运行在该服务器共享的文件逻辑连接上。 */
function sftpFetch<T>(serverId: string, path: string, options: ApiFetchOptions = {}): Promise<T> {
  return withServerConnection(serverId, "files", (connectionId) => apiFetch<T>(`/sftp/${encodeURIComponent(serverId)}${path}`, {
    ...options,
    headers: { ...options.headers as Record<string, string> | undefined, ...connectionHeader(connectionId) },
  }))
}

interface PreAuthenticateCredential {
  authMethod?: TerminalAuthMethod
  password?: string
  privateKey?: string
  secret?: string
  privateKeyPassphrase?: string
}

type AuthPromptResponder = (
  response: string[] | TerminalAuthResponsePayload,
  cancelled?: boolean,
  authMethod?: TerminalAuthMethod,
) => void

function runPreAuthentication(
  url: string,
  credential: PreAuthenticateCredential,
  onAuthPrompt: (prompt: TerminalAuthPrompt, respond: AuthPromptResponder) => void,
  onHostKeyPrompt?: (prompt: TerminalHostKeyPrompt, respond: TerminalHostKeyResponder) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      try {
        ws.close(1000, "sftp auth finished")
      } catch {
        // ignore close errors
      }
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "auth_start",
        data: {
          auth_method: credential.authMethod,
          password: credential.password,
          private_key: credential.privateKey,
          secret: credential.secret,
          private_key_passphrase: credential.privateKeyPassphrase,
        },
      }))
    }

    ws.onerror = () => {
      finish(new Error("sftp pre-authentication websocket failed"))
    }

    ws.onclose = (event) => {
      if (!settled && event.code !== 1000) {
        finish(new Error(event.reason || "sftp pre-authentication websocket closed"))
      }
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string; data?: unknown }
        if (message.type === "authenticated") {
          finish()
          return
        }
        if (message.type === "error") {
          const data = message.data as { error?: string; message?: string } | undefined
          const error = new Error(data?.message || data?.error || "sftp pre-authentication failed")
          ;(error as Error & { code?: string }).code = data?.error
          finish(error)
          return
        }
        if (message.type === "auth_prompt" && message.data && typeof message.data === "object") {
          const prompt = message.data as TerminalAuthPrompt
          onAuthPrompt(prompt, (response, cancelled = false, authMethod) => {
            const payload: TerminalAuthResponsePayload & { authMethod?: TerminalAuthMethod } = Array.isArray(response)
              ? { answers: response, authMethod }
              : {
                  answers: response.answers ?? [],
                  authMethod: response.authMethod ?? authMethod,
                  password: response.password,
                  privateKey: response.privateKey,
                  privateKeyPassphrase: response.privateKeyPassphrase,
                }
            ws.send(JSON.stringify({
              type: "auth_response",
              data: {
                request_id: prompt.request_id,
                answers: payload.answers,
                cancelled,
                auth_method: payload.authMethod,
                password: payload.password,
                private_key: payload.privateKey,
                private_key_passphrase: payload.privateKeyPassphrase,
              },
            }))
          })
        }
        if (message.type === "host_key_prompt" && message.data && typeof message.data === "object") {
          const prompt = message.data as TerminalHostKeyPrompt
          const respond: TerminalHostKeyResponder = (accepted, fingerprint) => {
            ws.send(JSON.stringify({
              type: "host_key_response",
              data: {
                request_id: prompt.request_id,
                accepted,
                fingerprint,
              },
            }))
          }
          if (onHostKeyPrompt) {
            onHostKeyPrompt(prompt, respond)
          } else {
            respond(false)
          }
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error("failed to parse sftp auth websocket message"))
      }
    }
  })
}

/**
 * 实例的 SFTP 接口：目录与文件操作走文件逻辑连接，上传、下载与服务器间中转都是传输任务。
 */
export const sftpApi = {
  async listDirectory(serverId: string, path: string = "/", signal?: AbortSignal): Promise<DirectoryListResponse> {
    return sftpFetch<DirectoryListResponse>(serverId, `/list?path=${encodeURIComponent(path)}`, {
      signal,
      retry: false,
    })
  },

  /**
   * 使用临时凭据建立 SFTP 连接，不保存凭据。
   */
  async authenticate(
    serverId: string,
    authMethod: TerminalAuthMethod,
    secret: string,
    privateKeyPassphrase?: string,
    options?: {
      password?: string
      privateKey?: string
    },
  ): Promise<void> {
    await sftpFetch<void>(serverId, "/auth", {
      method: "POST",
      body: {
        auth_method: authMethod,
        secret,
        password: options?.password,
        private_key: options?.privateKey,
        private_key_passphrase: privateKeyPassphrase || undefined,
      },
      retry: false,
      timeout: 30000,
    })
  },

  /** 交互式认证（键盘交互、主机密钥确认）通过 WebSocket 完成。 */
  async preAuthenticate(
    serverId: string,
    credential: PreAuthenticateCredential,
    onAuthPrompt: (prompt: TerminalAuthPrompt, respond: AuthPromptResponder) => void,
    onHostKeyPrompt?: (prompt: TerminalHostKeyPrompt, respond: TerminalHostKeyResponder) => void,
  ): Promise<void> {
    await withServerConnection(serverId, "files", async (connectionId) => {
      const ticket = await createAccessTicket({ type: "ws_sftp_auth", server_id: serverId, connection_id: connectionId })
      const params = new URLSearchParams({ ticket })
      const url = getWebSocketUrl(`/api/v1/sftp/${encodeURIComponent(serverId)}/auth/ws?${params.toString()}`)
      await runPreAuthentication(url, credential, onAuthPrompt, onHostKeyPrompt)
    })
  },

  async getFileInfo(serverId: string, path: string): Promise<FileInfo> {
    return sftpFetch<FileInfo>(serverId, `/stat?path=${encodeURIComponent(path)}`)
  },

  async createDirectory(serverId: string, path: string): Promise<FileInfo> {
    return sftpFetch<FileInfo>(serverId, "/mkdir", { method: "POST", body: { path } })
  },

  /**
   * 同步删除单个普通文件。目录必须通过 deletePaths 处理。
   */
  async delete(serverId: string, path: string): Promise<FileInfo> {
    return sftpFetch<FileInfo>(serverId, "/delete", { method: "DELETE", body: { path }, retry: false })
  },

  async deletePaths(serverId: string, paths: string[]): Promise<SftpDeletePathsResult> {
    return sftpFetch<SftpDeletePathsResult>(serverId, "/delete-paths", { method: "POST", body: { paths }, retry: false })
  },

  async rename(serverId: string, oldPath: string, newPath: string): Promise<FileInfo> {
    return sftpFetch<FileInfo>(serverId, "/rename", { method: "POST", body: { old_path: oldPath, new_path: newPath } })
  },

  async chmod(serverId: string, path: string, mode: string): Promise<void> {
    await sftpFetch<unknown>(serverId, "/chmod", { method: "POST", body: { path, mode } })
  },

  async readFile(serverId: string, path: string): Promise<string> {
    return sftpFetch<string>(serverId, `/read?path=${encodeURIComponent(path)}`, {
      headers: { Accept: "text/plain" },
      retry: false,
    })
  },

  async writeFile(serverId: string, path: string, content: string): Promise<FileInfo> {
    return sftpFetch<FileInfo>(serverId, "/write", { method: "POST", body: { path, content } })
  },

  async getDiskUsage(serverId: string, path: string = "/"): Promise<DiskUsageResponse> {
    return sftpFetch<DiskUsageResponse>(serverId, `/disk-usage?path=${encodeURIComponent(path)}`)
  },

  /**
   * 同步批量删除普通文件。包含目录的操作必须通过 deletePaths 处理。
   */
  async batchDelete(serverId: string, paths: string[]): Promise<BatchDeleteResponse> {
    return sftpFetch<BatchDeleteResponse>(serverId, "/batch-delete", {
      method: "POST",
      body: { paths },
      timeout: 600000,
      retry: false,
    })
  },

  getTransfer: transferJobsApi.getById,

  async listTransfers() {
    return (await transferJobsApi.list({ page_size: 50 })).jobs
  },

  cancelTransfer: transferJobsApi.cancel,

  async uploadFile(serverId, remotePath, file, { onStarted, onProgress, signal }) {
    const job = await transferJobsApi.createUpload({
      serverId,
      targetPath: remotePath,
      fileName: file.name,
      fileSize: file.size,
    })
    onStarted(job.id)
    await transferJobsApi.uploadInput(job.id, file, { onProgress, signal })
  },

  async uploadFolder(serverId, remotePath, folder, { merge, onStarted, onProgress, signal }) {
    const bundle = createFolderBundle(folder)
    const job = await transferJobsApi.createUpload({
      serverId,
      targetPath: remotePath,
      fileName: folder.name,
      fileSize: bundle.size,
      folder: true,
      merge,
    })
    onStarted(job.id)
    await transferJobsApi.uploadInput(job.id, bundle, { onProgress, signal })
  },

  async downloadFile(serverId, remotePath, { onStarted }) {
    const job = await transferJobsApi.createDownload({ serverId, sourcePaths: [remotePath] })
    onStarted(job.id)
  },

  async batchDownload(serverId, remotePaths, excludePatterns, { onStarted }) {
    const job = await transferJobsApi.createDownload({ serverId, sourcePaths: remotePaths, excludePatterns })
    onStarted(job.id)
  },

  // 中转由实例使用已保存的服务器凭据执行，不接收临时凭据。
  async directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, { onStarted }) {
    const job = await transferJobsApi.createRelay({ sourceServerId, sourcePath, targetServerId, targetPath })
    onStarted(job.id)
  },

  deliverArtifact: transferJobsApi.downloadArtifact,
} satisfies FileTransferSftpApi & Record<string, unknown>
