export const SFTP_FILE_DRAG_TYPE = "easyssh/sftp-file"

export interface CrossSessionFileDragData {
  type: typeof SFTP_FILE_DRAG_TYPE
  sessionId: string
  fileName: string
  filePath: string
  fileType: "file" | "directory"
  sourceSessionId: string
}

export function isSftpFileDragData(data: Record<string | symbol, unknown>): data is Record<string | symbol, unknown> & CrossSessionFileDragData {
  return data.type === SFTP_FILE_DRAG_TYPE &&
    typeof data.sessionId === "string" && typeof data.sourceSessionId === "string" &&
    typeof data.fileName === "string" && typeof data.filePath === "string" &&
    (data.fileType === "file" || data.fileType === "directory")
}
