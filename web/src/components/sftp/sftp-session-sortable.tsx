
import React from "react"
import { GripVertical, Upload } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import { getDragSourceSessionId } from "@/lib/drag-state"
import type { SftpWorkspaceSession } from "@/lib/session/workspace"

export interface CrossSessionDragData {
  sessionId: string
  fileName: string
  filePath: string
  fileType: "file" | "directory"
  sourceSessionId: string
}

export interface DragPreviewToolbarProps {
  sessionLabel: string
  sessionColor?: string
  host: string
}

export const DragPreviewToolbar = React.memo(function DragPreviewToolbar({
  sessionLabel,
  sessionColor,
  host,
}: DragPreviewToolbarProps) {
  return (
    <div className="bg-card border rounded-lg shadow-2xl px-3 py-2 flex items-center gap-2 min-w-[200px] cursor-grabbing">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      {sessionColor && (
        <div
          className="w-1 h-5 rounded-full"
          style={{ backgroundColor: sessionColor }}
        />
      )}
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground">{sessionLabel}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{host}</span>
      </div>
    </div>
  )
})

export interface SortableSessionProps {
  session: SftpWorkspaceSession
  children: React.ReactNode
  onCrossSessionDrop?: (targetSessionId: string, dragData: CrossSessionDragData) => void
  dropOverlayTexts?: {
    title: string
    description: string
  }
}

export const SortableSession = React.memo(function SortableSession({
  session,
  children,
  onCrossSessionDrop,
  dropOverlayTexts,
}: SortableSessionProps) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id })

  const [isDragOver, setIsDragOver] = React.useState(false)
  const dragOverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const style = React.useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
  }), [transform, transition])

  React.useEffect(() => {
    return () => {
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current)
      }
    }
  }, [])

  const handleDragOver = React.useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("application/json")) {
      return
    }

    const sourceId = getDragSourceSessionId()
    if (sourceId === session.id) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)

    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current)
    }
    dragOverTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false)
    }, 100)
  }, [session.id])

  const handleDragEnter = React.useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes("application/json")) {
      const sourceId = getDragSourceSessionId()
      if (sourceId !== session.id) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
  }, [session.id])

  const handleDragLeave = React.useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDrop = React.useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)

    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current)
      dragOverTimeoutRef.current = null
    }

    try {
      const jsonData = event.dataTransfer.getData("application/json")
      if (jsonData) {
        const dragData = JSON.parse(jsonData) as CrossSessionDragData
        if (dragData.sourceSessionId !== session.id && onCrossSessionDrop) {
          onCrossSessionDrop(session.id, dragData)
        }
      }
    } catch (error) {
      console.error("解析拖拽数据失败:", error)
    }
  }, [session.id, onCrossSessionDrop])

  const isValidDropTarget = isDragOver && session.isConnected

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative h-full min-h-0",
        isDragging && "opacity-60",
      )}
      data-session-id={session.id}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isValidDropTarget && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[2px] border-2 border-dashed border-primary/60 m-1 rounded-lg pointer-events-none animate-in fade-in-0 duration-200">
          <div className="text-center">
            <Upload className="h-10 w-10 text-primary mx-auto mb-3 animate-bounce" />
            <p className="text-base font-semibold text-primary">
              {dropOverlayTexts?.title ?? "Drop here to transfer"}
            </p>
            <p className="text-xs text-primary/70 mt-1">
              {dropOverlayTexts?.description ?? "Release to transfer files to this server"}
            </p>
          </div>
        </div>
      )}
    </div>
  )
})
