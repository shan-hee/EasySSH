import { useEffect, useEffectEvent, useState } from "react"
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { isSftpFileDragData, type CrossSessionFileDragData } from "@/lib/session/cross-session-file-drag"

/** A single innermost target handles each drop, including nested workspace panes. */
export function useCrossSessionFileDropTarget({ sessionId, enabled, onDrop }: {
  sessionId: string
  enabled: boolean
  onDrop?: (sessionId: string, data: CrossSessionFileDragData) => void
}) {
  const [element, fileDropRef] = useState<HTMLElement | null>(null)
  const [isCrossSessionFileDragOver, setDragOver] = useState(false)
  const accept = useEffectEvent((data: Record<string | symbol, unknown>) => enabled && !!onDrop && isSftpFileDragData(data) && data.sourceSessionId !== sessionId)
  const drop = useEffectEvent((data: CrossSessionFileDragData) => onDrop?.(sessionId, data))
  useEffect(() => {
    if (!element) return
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => !element.closest('[inert], [aria-hidden="true"]') && accept(source.data),
      getDropEffect: () => "copy",
      onDragEnter: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
      onDrop: ({ source, location, self }) => {
        setDragOver(false)
        if (location.current.dropTargets[0]?.element === self.element && isSftpFileDragData(source.data)) drop(source.data)
      },
    })
  }, [element])
  return { fileDropRef, isCrossSessionFileDragOver }
}
