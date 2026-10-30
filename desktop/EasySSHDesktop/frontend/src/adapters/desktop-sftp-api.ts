import { Dialogs } from "@wailsio/runtime"
import type { AuthMethod, SshWorkspaceApiClient } from "@easyssh/app/desktop"
import { supportsKeyboardInteractive } from "@easyssh/app/desktop"
import type {
  BatchDeleteResponse,
  DirectTransferOptions,
  DiskUsageResponse,
  DirectoryListResponse,
  FileInfo,
  SftpDeletePathsResult,
} from "@easyssh/app/lib/sftp-types"
import type { TransferJob } from "@easyssh/app/desktop"
import { sftpRemoteBaseName } from "@easyssh/app/lib/sftp-file-utils"
import {
  DesktopSFTPService,
  type DesktopSSHCredential,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
import { desktopAuthRequiresPassword, desktopAuthRequiresPrivateKey, toDesktopAuthMethod } from "./desktop-server-api"
import type { DesktopGatewayInfo } from "./desktop-runtime"

type DesktopSftpApi = NonNullable<SshWorkspaceApiClient["sftp"]>
type DesktopSftpPreAuthPrompt = Parameters<Parameters<NonNullable<DesktopSftpApi["preAuthenticate"]>>[2]>[0]
type DesktopSftpHostKeyPrompt = Parameters<NonNullable<Parameters<NonNullable<DesktopSftpApi["preAuthenticate"]>>[3]>>[0]

const desktopKeyboardInteractiveGatewayRequired = "desktop gateway is required for keyboard-interactive authentication"

type DesktopDirectTransferSide = "source" | "target"

function createDesktopSftpError(message: string, code?: string) {
  const error = new Error(message)
  if (code) {
    const codedError = error as Error & { code?: string }
    codedError.code = code
  }
  return error
}

function getDesktopErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function classifyDesktopSftpAuthErrorCode(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes("host key trust has been revoked")) return "host_key_revoked"
  if (
    normalized.includes("host key verification failed") ||
    normalized.includes("ssh host key verification failed")
  ) {
    return "sftp_host_key_changed"
  }
  if (normalized.includes("private_key_passphrase_required")) return "sftp_private_key_passphrase_required"
  if (normalized.includes("private_key_passphrase_invalid")) return "sftp_private_key_passphrase_invalid"
  if (normalized.includes("keyboard_interactive_required") || normalized.includes("keyboard-interactive")) return "keyboard_interactive_required"
  if (
    normalized.includes("server credential is required") ||
    normalized.includes("unable to authenticate") ||
    normalized.includes("permission denied") ||
    normalized.includes("authentication failed") ||
    normalized.includes("no supported methods remain") ||
    normalized.includes("attempted methods") ||
    normalized.includes("failed to parse private key")
  ) {
    return "sftp_credential_required"
  }
  return null
}

function getDesktopDirectTransferSide(message: string): DesktopDirectTransferSide | null {
  const normalized = message.toLowerCase()
  if (normalized.includes("failed to connect source server")) {
    return "source"
  }
  if (normalized.includes("failed to connect target server")) {
    return "target"
  }
  return null
}

function normalizeDesktopDirectTransferError(error: unknown) {
  const message = getDesktopErrorMessage(error)
  const side = getDesktopDirectTransferSide(message)
  const code = classifyDesktopSftpAuthErrorCode(message)
  if (!side || !code) {
    return error instanceof Error ? error : new Error(message)
  }
  return createDesktopSftpError(message, `${side}_${code}`)
}

function toDesktopTransferCredential(credential?: DirectTransferOptions["sourceCredential"]): DesktopSSHCredential | undefined {
  if (!credential) {
    return undefined
  }
  const authMethod = toDesktopAuthMethod(credential.auth_method)
  const method = credential.auth_method
  const password = credential.password || (desktopAuthRequiresPassword(method) && !desktopAuthRequiresPrivateKey(method) ? credential.secret : "") || ""
  const privateKey = credential.private_key || (desktopAuthRequiresPrivateKey(method) && !desktopAuthRequiresPassword(method) ? credential.secret : "") || ""

  return {
    authMethod,
    secret: credential.secret || "",
    password,
    privateKey,
    privateKeyPassphrase: credential.private_key_passphrase,
  }
}

function normalizeFileInfo(info: FileInfo): FileInfo {
  return {
    name: info.name,
    path: info.path,
    size: Number(info.size) || 0,
    mode: Number(info.mode) || 0,
    mod_time: info.mod_time,
    is_dir: Boolean(info.is_dir),
    is_link: Boolean(info.is_link),
    link_target: info.link_target,
    permission: info.permission,
  }
}

function normalizeDirectoryList(result: DirectoryListResponse): DirectoryListResponse {
  return {
    path: result.path,
    parent: result.parent,
    can_read: result.can_read,
    files: (result.files || []).map(normalizeFileInfo),
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"))

    reader.readAsDataURL(file)
  })
}

async function chooseSavePath(filename: string) {
  const localPath = await Dialogs.SaveFile({
    Filename: filename,
    CanCreateDirectories: true,
  })

  if (!localPath) {
    // 用户关闭保存对话框视为取消，而不是传输失败。
    throw new DOMException("Save cancelled", "AbortError")
  }

  return localPath
}

export function createDesktopSftpApi(gateway?: DesktopGatewayInfo, runtimeReady = true): DesktopSftpApi {
  const authenticate: NonNullable<DesktopSftpApi["authenticate"]> = async (serverId, authMethod, secret, privateKeyPassphrase, options) => {
    if (supportsKeyboardInteractive(authMethod)) {
      throw createDesktopSftpError(desktopKeyboardInteractiveGatewayRequired, "keyboard_interactive_required")
    }
    const desktopAuthMethod = toDesktopAuthMethod(authMethod)
    await DesktopSFTPService.Authenticate({
      serverId,
      authMethod: desktopAuthMethod,
      secret: secret || "",
      password: options?.password || (desktopAuthRequiresPassword(authMethod) && !desktopAuthRequiresPrivateKey(authMethod) ? secret : "") || "",
      privateKey: options?.privateKey || (desktopAuthRequiresPrivateKey(authMethod) && !desktopAuthRequiresPassword(authMethod) ? secret : "") || "",
      privateKeyPassphrase,
    })
  }

  return {
    async preAuthenticate(serverId, credential, onAuthPrompt, onHostKeyPrompt) {
      if (!gateway?.wsBaseUrl || !gateway.token) {
        if (!runtimeReady) {
          throw createDesktopSftpError("desktop sftp runtime is not ready", "sftp_runtime_not_ready")
        }
        if (supportsKeyboardInteractive(credential.authMethod)) {
          throw createDesktopSftpError(desktopKeyboardInteractiveGatewayRequired, "keyboard_interactive_required")
        }
        await authenticate(
          serverId,
          credential.authMethod || "password",
          credential.secret || "",
          credential.privateKeyPassphrase,
          {
            password: credential.password,
            privateKey: credential.privateKey,
          },
        )
        return
      }

      await new Promise<void>((resolve, reject) => {
        const params = new URLSearchParams()
        params.set("serverId", serverId)
        params.set("ticket", gateway.token || "desktop")
        const ws = new WebSocket(`${gateway.wsBaseUrl}/sftp-auth?${params.toString()}`)
        let settled = false

        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          try {
            ws.close(1000, "sftp auth finished")
          } catch {
            // Ignore close errors.
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
              const prompt = message.data as DesktopSftpPreAuthPrompt
              onAuthPrompt(prompt, (response, cancelled = false, authMethod) => {
                const payload: {
                  answers?: string[]
                  authMethod?: AuthMethod
                  password?: string
                  privateKey?: string
                  privateKeyPassphrase?: string
                } = Array.isArray(response)
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
              const prompt = message.data as DesktopSftpHostKeyPrompt
              const respond = (accepted: boolean, fingerprint?: string) => {
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
    },
    authenticate,
    async listDirectory(serverId, remotePath = "/", signal) {
      signal?.throwIfAborted()
      const request = DesktopSFTPService.ListDirectoryContext({
        serverId,
        path: remotePath,
      })
      const cancel = () => { void request.cancel().catch(() => undefined) }
      signal?.addEventListener("abort", cancel, { once: true })
      try {
        return normalizeDirectoryList(await request as DirectoryListResponse)
      } catch (error) {
        signal?.throwIfAborted()
        const message = getDesktopErrorMessage(error)
        const directoryError = message.includes("failed to read directory") && !/EOF|connection (?:lost|closed|reset)|broken pipe/i.test(message)
        throw createDesktopSftpError(message, directoryError ? "sftp_directory_error" : "sftp_connection_error")
      } finally {
        signal?.removeEventListener("abort", cancel)
      }
    },
    async getFileInfo(serverId, remotePath) {
      return normalizeFileInfo(await DesktopSFTPService.GetFileInfo({ serverId, path: remotePath }) as FileInfo)
    },
    async getDiskUsage(serverId, remotePath = "/") {
      return await DesktopSFTPService.GetDiskUsage({
        serverId,
        path: remotePath,
      }) as DiskUsageResponse
    },
    async delete(serverId, remotePath) {
      return normalizeFileInfo(await DesktopSFTPService.Delete({ serverId, path: remotePath }) as FileInfo)
    },
    async deletePaths(serverId, paths) {
      return await DesktopSFTPService.DeletePaths({ serverId, paths }) as SftpDeletePathsResult
    },
    async batchDelete(serverId, paths) {
      return await DesktopSFTPService.BatchDelete({ serverId, paths }) as BatchDeleteResponse
    },
    async createDirectory(serverId, remotePath) {
      return normalizeFileInfo(await DesktopSFTPService.CreateDirectory({ serverId, path: remotePath }) as FileInfo)
    },
    async rename(serverId, oldPath, newPath) {
      return normalizeFileInfo(await DesktopSFTPService.Rename({ serverId, oldPath, newPath }) as FileInfo)
    },
    async readFile(serverId, remotePath) {
      return await DesktopSFTPService.ReadFile({ serverId, path: remotePath })
    },
    async writeFile(serverId, remotePath, content) {
      return normalizeFileInfo(await DesktopSFTPService.WriteFile({
        serverId,
        path: remotePath,
        content,
      }) as FileInfo)
    },
    async chmod(serverId, remotePath, mode) {
      await DesktopSFTPService.Chmod({ serverId, path: remotePath, mode })
    },
    async getTransfer(id) {
      return await DesktopSFTPService.GetTransfer(id) as TransferJob
    },
    async listTransfers() {
      const result = await DesktopSFTPService.ListTransfers({ page: 1, page_size: 50 })
      return result.jobs as TransferJob[]
    },
    async cancelTransfer(id) {
      await DesktopSFTPService.CancelTransfer(id)
    },
    // 桌面传输以调用方的任务 ID 落库，启动调用在传输结束后返回。
    async downloadFile(serverId, remotePath, { taskId, onStarted }) {
      const localPath = await chooseSavePath(sftpRemoteBaseName(remotePath, "download"))
      onStarted(taskId)
      await DesktopSFTPService.DownloadFile({ serverId, path: remotePath, localPath, taskId })
    },
    async batchDownload(serverId, paths, excludePatterns, { taskId, onStarted }) {
      const fallbackName = paths.length === 1
        ? `${sftpRemoteBaseName(paths[0] || "", "download")}.zip`
        : "easyssh-download.zip"
      const localPath = await chooseSavePath(fallbackName)
      onStarted(taskId)
      await DesktopSFTPService.BatchDownload({
        serverId,
        paths,
        localPath,
        excludePatterns,
        taskId,
      })
    },
    async uploadFile(serverId, remotePath, file, { taskId, onStarted, onProgress }) {
      const data = await readFileAsBase64(file)
      onStarted(taskId)
      await DesktopSFTPService.UploadFile({
        serverId,
        path: remotePath,
        fileName: file.name,
        data,
        taskId,
      })
      onProgress?.(file.size, file.size)
    },
    async directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, options) {
      options.onStarted(options.taskId)
      try {
        await DesktopSFTPService.DirectTransfer({
          sourceServerId,
          sourcePath,
          targetServerId,
          targetPath,
          taskId: options.taskId,
          sourceCredential: toDesktopTransferCredential(options.sourceCredential),
          targetCredential: toDesktopTransferCredential(options.targetCredential),
        })
      } catch (error) {
        throw normalizeDesktopDirectTransferError(error)
      }
    },
  }
}
