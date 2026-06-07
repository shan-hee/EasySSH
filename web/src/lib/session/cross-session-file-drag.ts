export const CROSS_SESSION_FILE_DRAG_MIME = "application/json"

export interface CrossSessionFileDragData {
  sessionId: string
  fileName: string
  filePath: string
  fileType: "file" | "directory"
  sourceSessionId: string
}

export const hasCrossSessionFileDragData = (dataTransfer: DataTransfer) => (
  Array.from(dataTransfer.types).includes(CROSS_SESSION_FILE_DRAG_MIME)
)

export const parseCrossSessionFileDragData = (
  dataTransfer: DataTransfer,
): CrossSessionFileDragData | null => {
  const jsonData = dataTransfer.getData(CROSS_SESSION_FILE_DRAG_MIME)
  if (!jsonData) return null

  try {
    const parsed = JSON.parse(jsonData) as Partial<CrossSessionFileDragData>
    if (
      typeof parsed.sourceSessionId === "string" &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.fileName === "string" &&
      typeof parsed.filePath === "string" &&
      (parsed.fileType === "file" || parsed.fileType === "directory")
    ) {
      return parsed as CrossSessionFileDragData
    }
  } catch (error) {
    console.error("解析跨会话拖拽数据失败:", error)
  }

  return null
}
