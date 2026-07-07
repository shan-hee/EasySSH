import { Dialogs } from "@wailsio/runtime"
import type { SshWorkspaceApiClient } from "@easyssh/ssh-workspace/desktop"
import type {
  BatchDeleteResponse,
  DirectTransferOptions,
  DirectTransferResponse,
  DiskUsageResponse,
  DirectoryListResponse,
  FileInfo,
  UploadTaskStatus,
  UploadTaskListResponse,
} from "@/lib/sftp-types"
import { sftpRemoteBaseName } from "@/lib/sftp-file-utils"
import {
  DesktopSFTPService,
  DesktopServerAuthMethod,
  type DesktopSSHCredential,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

type DesktopSftpApi = NonNullable<SshWorkspaceApiClient["sftp"]>

const desktopDownloadCancelledMessage = "已取消保存"
function toDesktopServerAuthMethod(authMethod?: string) {
  return authMethod === "key"
    ? DesktopServerAuthMethod.DesktopServerAuthKey
    : DesktopServerAuthMethod.DesktopServerAuthPassword
}

function toDesktopTransferCredential(credential?: DirectTransferOptions["sourceCredential"]): DesktopSSHCredential | undefined {
  if (!credential) {
    return undefined
  }
  const authMethod = toDesktopServerAuthMethod(credential.auth_method)
  const secret = authMethod === DesktopServerAuthMethod.DesktopServerAuthKey
    ? credential.secret || credential.private_key || ""
    : credential.secret || credential.password || ""

  return {
    authMethod,
    secret,
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
    throw new Error(desktopDownloadCancelledMessage)
  }

  return localPath
}

export function createDesktopSftpApi(): DesktopSftpApi {
  return {
    async authenticate(serverId, authMethod, secret, privateKeyPassphrase, options) {
      const desktopAuthMethod = toDesktopServerAuthMethod(authMethod)
      const credentialSecret = desktopAuthMethod === DesktopServerAuthMethod.DesktopServerAuthKey
        ? secret || options?.privateKey || ""
        : secret || options?.password || ""
      await DesktopSFTPService.Authenticate({
        serverId,
        authMethod: desktopAuthMethod,
        secret: credentialSecret,
        privateKeyPassphrase,
      })
    },
    async listDirectory(serverId, remotePath = "/") {
      return normalizeDirectoryList(await DesktopSFTPService.ListDirectory({
        serverId,
        path: remotePath,
      }) as DirectoryListResponse)
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
    async downloadFile(serverId, remotePath, taskId) {
      const localPath = await chooseSavePath(sftpRemoteBaseName(remotePath, "download"))
      await DesktopSFTPService.DownloadFile({ serverId, path: remotePath, localPath, taskId })
    },
    async batchDownload(serverId, paths, mode, excludePatterns, taskId) {
      const extension = mode === "fast" ? "tar.gz" : "zip"
      const fallbackName = paths.length === 1
        ? `${sftpRemoteBaseName(paths[0] || "", "download")}.${extension}`
        : `easyssh-download.${extension}`
      const localPath = await chooseSavePath(fallbackName)
      await DesktopSFTPService.BatchDownload({
        serverId,
        paths,
        localPath,
        mode,
        excludePatterns,
        taskId,
      })
    },
    async uploadFile(serverId, remotePath, file, onProgress, wsTaskId) {
      const data = await readFileAsBase64(file)
      const fileInfo = normalizeFileInfo(await DesktopSFTPService.UploadFile({
        serverId,
        path: remotePath,
        fileName: file.name,
        data,
        taskId: wsTaskId,
      }) as FileInfo)

      onProgress?.(file.size, file.size)
      return fileInfo
    },
    async createUploadTask() {
      const result = await DesktopSFTPService.CreateUploadTask()
      return { task_id: result.task_id || `desktop-upload-${Date.now()}` }
    },
    async listUploadTasks() {
      return await DesktopSFTPService.ListUploadTasks() as UploadTaskListResponse
    },
    async getUploadTask(taskId) {
      return await DesktopSFTPService.GetUploadTask(taskId) as UploadTaskStatus
    },
    async getTransferTask(taskId) {
      return await DesktopSFTPService.GetTransferTask(taskId) as UploadTaskStatus
    },
    async cancelUploadTask(taskId) {
      await DesktopSFTPService.CancelUploadTask(taskId)
    },
    async directTransfer(sourceServerId, sourcePath, targetServerId, targetPath, options) {
      return await DesktopSFTPService.DirectTransfer({
        sourceServerId,
        sourcePath,
        targetServerId,
        targetPath,
        taskId: options?.taskId,
        sourceCredential: toDesktopTransferCredential(options?.sourceCredential),
        targetCredential: toDesktopTransferCredential(options?.targetCredential),
      }) as DirectTransferResponse
    },
    async cancelTransfer(taskId) {
      await DesktopSFTPService.CancelTransfer(taskId)
    },
    async closeConnection(serverId) {
      await DesktopSFTPService.CloseConnection(serverId)
    },
    uploadUsesProgressSocket: false,
    serverTransferUsesProgressSocket: false,
  }
}
