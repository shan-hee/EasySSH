const SPLIT_PANE_SESSION_DRAG_TYPE = "application/x-easyssh-split-pane-session"

export const setSplitPaneDragSessionId = (
  dataTransfer: DataTransfer,
  sessionId: string
) => {
  dataTransfer.setData(SPLIT_PANE_SESSION_DRAG_TYPE, sessionId)
  dataTransfer.setData("text/plain", sessionId)
  dataTransfer.effectAllowed = "move"
}

export const hasSplitPaneDragSession = (dataTransfer: DataTransfer) => (
  Array.from(dataTransfer.types).includes(SPLIT_PANE_SESSION_DRAG_TYPE)
)

export const getSplitPaneDragSessionId = (dataTransfer: DataTransfer) => {
  if (!hasSplitPaneDragSession(dataTransfer)) return null
  return dataTransfer.getData(SPLIT_PANE_SESSION_DRAG_TYPE) || null
}
