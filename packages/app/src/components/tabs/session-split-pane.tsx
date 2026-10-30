import { type ReactNode } from "react"
import { useCrossSessionFileDropTarget } from "@/hooks/use-cross-session-file-drop-target"
import type { CrossSessionFileDragData } from "@/lib/session/cross-session-file-drag"
import { cn } from "@/lib/utils"

/** Stable session body; Dockview owns the workspace headers and docking gestures. */
export function SessionSplitPane({
  sessionId, isVisible = true, isSplit = true, isSftp = false, isActive = false,
  backgroundColor, surface = "normal", dropOverlay, children, onFocus,
  canAcceptCrossSessionFileDrop = false, onCrossSessionFileDrop,
}: {
  sessionId: string
  isVisible?: boolean
  isSplit?: boolean
  isSftp?: boolean
  isActive?: boolean
  backgroundColor?: string
  surface?: "normal" | "transparent"
  dropOverlay?: ReactNode
  children: ReactNode
  onFocus?: () => void
  canAcceptCrossSessionFileDrop?: boolean
  onCrossSessionFileDrop?: (sessionId: string, data: CrossSessionFileDragData) => void
}) {
  const { fileDropRef, isCrossSessionFileDragOver } = useCrossSessionFileDropTarget({
    sessionId, enabled: isVisible && canAcceptCrossSessionFileDrop, onDrop: onCrossSessionFileDrop,
  })
  return <div
    ref={fileDropRef}
    aria-hidden={!isVisible} inert={!isVisible}
    data-split-session-id={sessionId} data-extra-session-id={isSftp ? sessionId : undefined}
    className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", isActive && "z-10")}
    onPointerDownCapture={onFocus} onFocusCapture={onFocus}
  >
    {isSplit && surface !== "transparent" && (
      <div aria-hidden="true" className="absolute inset-0 bg-background/70" style={backgroundColor ? { backgroundColor } : undefined} />
    )}
    {dropOverlay}
    {isCrossSessionFileDragOver && <div className="pointer-events-none absolute inset-1 z-50 rounded-lg border-2 border-dashed border-primary/65 bg-primary/10" />}
    <div className="relative flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">{children}</div>
  </div>
}
