import type { TFunction } from "i18next"

export const taskTypeLabelKeys: Record<string, string> = {
  command: "typeCommand",
  command_execute: "typeCommand",
  script: "typeScript",
  sftp_upload: "typeSftpUpload",
  sftp_download: "typeSftpDownload",
  sftp_transfer: "typeSftpTransfer",
  sftp_recursive_delete: "typeSftpRecursiveDelete",
  sftp_mkdir: "typeSftpMkdir",
  sftp_rename: "typeSftpRename",
  sftp_chmod: "typeSftpChmod",
  sftp_write: "typeSftpWrite",
  sftp_delete_file: "typeSftpDeleteFile",
  sftp_batch_delete: "typeSftpBatchDelete",
}

export const primaryTaskTypeFilterValues = [
  "command",
  "script",
  "sftp_upload",
  "sftp_download",
  "sftp_transfer",
  "sftp_recursive_delete",
  "sftp_write",
  "sftp_delete_file",
  "sftp_batch_delete",
  "sftp_mkdir",
  "sftp_rename",
  "sftp_chmod",
] as const

export function formatTaskTypeLabel(type: string, t: TFunction): string {
  if (taskTypeLabelKeys[type]) {
    return t(taskTypeLabelKeys[type])
  }
  if (type.startsWith("docker_")) {
    const action = type.slice("docker_".length)
    return t("typeDockerAction", { action, defaultValue: `Docker ${action}` })
  }
  return type
}
