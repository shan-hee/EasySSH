
import {
  startTransition,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { ChevronLeft, ChevronRight, Clipboard, CloudUpload, CornerDownRight, FolderInput, Home, Maximize2, Minimize2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { TransferTaskPanel } from "@/components/sftp/transfer-task-panel"
import { ActivityLogPane } from "@/components/ssh-workspace/activity-log-pane"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import type { TransferJob } from "@/lib/api/transfer-jobs"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"
import type { SftpTerminalPathActions } from "@/components/sftp/sftp-manager"

const PATH_DRAG_THRESHOLD_PX = 5

interface PathDragState {
  pointerId: number
  startX: number
  startY: number
  startScrollLeft: number
  dragging: boolean
}

export interface SftpWorkspaceToolbarProps {
  displayPath: string
  pathInputValue: string
  pathSegments: string[]
  isEditingPath: boolean
  isEditorOpen: boolean
  onPathInputValueChange: (value: string) => void
  onEditingPathChange: (value: boolean) => void
  onNavigate: (path: string) => void
  onNavigateBack?: () => void | Promise<void>
  canNavigateBack?: boolean
  onNavigateForward?: () => void | Promise<void>
  canNavigateForward?: boolean

  terminalPathActions?: SftpTerminalPathActions
  showTransferTasks: boolean
  transferTasks: WorkspaceTransferTask[]
  backgroundTransferJobs?: TransferJob[]
  onClearCompletedTransfers?: () => void
  onCancelTransfer?: (taskId: string) => void
  onCreateBackgroundUpload?: () => void
  onCancelBackgroundTransfer?: (jobId: string) => void
  onDeleteBackgroundTransfer?: (jobId: string) => void
  onDownloadBackgroundArtifact?: (jobId: string) => void
  isFullscreen: boolean
  onToggleFullscreen?: () => void
  onDisconnect: () => void
}

export function SftpWorkspaceToolbar({
  displayPath,
  pathInputValue,
  pathSegments,
  isEditingPath,
  isEditorOpen,
  onPathInputValueChange,
  onEditingPathChange,
  onNavigate,
  onNavigateBack,
  canNavigateBack,
  onNavigateForward,
  canNavigateForward,
  terminalPathActions,
  showTransferTasks,
  transferTasks,
  backgroundTransferJobs,
  onClearCompletedTransfers,
  onCancelTransfer,
  onCreateBackgroundUpload,
  onCancelBackgroundTransfer,
  onDeleteBackgroundTransfer,
  onDownloadBackgroundArtifact,
  isFullscreen,
  onToggleFullscreen,
  onDisconnect,
}: SftpWorkspaceToolbarProps) {
  const tSftp = useWorkspaceSftpTranslator()
  const workspace = useOptionalSshWorkspace()
  const showActivityLogPane = workspace?.layout !== "desktop"
  const pathScrollRef = useRef<HTMLDivElement | null>(null)
  const pathDragStateRef = useRef<PathDragState | null>(null)
  const suppressNextPathClickRef = useRef(false)
  const [isPathOverflowing, setIsPathOverflowing] = useState(false)
  const [isDraggingPath, setIsDraggingPath] = useState(false)

  useLayoutEffect(() => {
    const pathElement = pathScrollRef.current
    if (!pathElement || isEditingPath) {
      setIsPathOverflowing(false)
      return
    }

    const updateOverflowState = () => {
      setIsPathOverflowing(pathElement.scrollWidth > pathElement.clientWidth + 1)
    }

    updateOverflowState()
    const resizeObserver = new ResizeObserver(updateOverflowState)
    resizeObserver.observe(pathElement)

    return () => resizeObserver.disconnect()
  }, [displayPath, isEditingPath])

  const handlePathPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !isPathOverflowing) {
      return
    }

    pathDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: event.currentTarget.scrollLeft,
      dragging: false,
    }
  }

  const handlePathPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = pathDragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragState.startX
    const deltaY = event.clientY - dragState.startY

    if (!dragState.dragging) {
      if (
        Math.abs(deltaX) < PATH_DRAG_THRESHOLD_PX ||
        Math.abs(deltaX) <= Math.abs(deltaY)
      ) {
        return
      }

      dragState.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDraggingPath(true)
    }

    event.preventDefault()
    event.currentTarget.scrollLeft = dragState.startScrollLeft - deltaX
  }

  const finishPathPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = pathDragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    suppressNextPathClickRef.current = dragState.dragging
    if (dragState.dragging) {
      window.setTimeout(() => {
        suppressNextPathClickRef.current = false
      }, 0)
    }
    pathDragStateRef.current = null
    setIsDraggingPath(false)
  }

  const cancelPathPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = pathDragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    pathDragStateRef.current = null
    suppressNextPathClickRef.current = false
    setIsDraggingPath(false)
  }

  const handlePathPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = pathDragStateRef.current
    if (
      dragState &&
      dragState.pointerId === event.pointerId &&
      !dragState.dragging
    ) {
      pathDragStateRef.current = null
    }
  }

  const navigateHome = () => {
    startTransition(() => {
      onNavigate("/")
    })
  }

  const navigateBack = () => {
    if (!canNavigateBack || !onNavigateBack) {
      return
    }

    startTransition(() => {
      void onNavigateBack()
    })
  }

  const navigateForward = () => {
    if (!canNavigateForward || !onNavigateForward) {
      return
    }

    startTransition(() => {
      void onNavigateForward()
    })
  }

  const finishPathEdit = (nextPath: string) => {
    onEditingPathChange(false)
    const normalized = nextPath.trim()
    if (normalized && normalized !== displayPath) {
      onNavigate(normalized)
    } else {
      onPathInputValueChange(displayPath)
    }
  }

  return (
    <div data-sftp-toolbar="workspace" className="border-b text-sm flex items-center justify-between px-3 py-1.5">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
            onClick={navigateBack}
            disabled={!canNavigateBack || !onNavigateBack}
            title={tSftp("historyBackTooltip")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
            onClick={navigateForward}
            disabled={!canNavigateForward || !onNavigateForward}
            title={tSftp("historyForwardTooltip")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            {isEditingPath ? (
              <>
                <button
                  onClick={navigateHome}
                  className={cn(
                    "absolute left-2 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded-md",
                    "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    "transition-all duration-200",
                  )}
                  title={tSftp("pathRootTooltip")}
                >
                  <Home className="h-3.5 w-3.5" />
                </button>
                <Input
                  data-sftp-glass-control="path"
                  value={pathInputValue}
                  onChange={(event) => onPathInputValueChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur()
                      finishPathEdit(event.currentTarget.value)
                    } else if (event.key === "Escape") {
                      onPathInputValueChange(displayPath)
                      onEditingPathChange(false)
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={(event) => finishPathEdit(event.target.value)}
                  autoFocus
                  placeholder={tSftp("pathInputPlaceholder")}
                  className="h-7 border-0 bg-muted py-0.5 pl-7 pr-2 font-mono text-xs leading-4 placeholder:text-muted-foreground"
                />
              </>
            ) : (
              <div
                ref={pathScrollRef}
                data-sftp-glass-control="path"
                onPointerDown={handlePathPointerDown}
                onPointerMove={handlePathPointerMove}
                onPointerUp={finishPathPointerDrag}
                onPointerCancel={cancelPathPointerDrag}
                onPointerLeave={handlePathPointerLeave}
                onClickCapture={(event) => {
                  if (!suppressNextPathClickRef.current) {
                    return
                  }

                  suppressNextPathClickRef.current = false
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={() => {
                  onPathInputValueChange(displayPath)
                  onEditingPathChange(true)
                }}
                className={cn(
                  "flex h-7 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border-0 bg-muted py-0.5 pl-7 pr-2",
                  "scrollbar-none font-mono text-xs leading-4 select-none",
                  isPathOverflowing ? "cursor-grab" : "cursor-text",
                  isDraggingPath && "cursor-grabbing",
                  "hover:bg-accent transition-colors",
                )}
                title={tSftp("pathClickToEdit")}
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    navigateHome()
                  }}
                  className={cn(
                    "absolute left-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md",
                    "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    "transition-all duration-200",
                  )}
                  title={tSftp("pathRootTooltip")}
                >
                  <Home className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    navigateHome()
                  }}
                  className="shrink-0 whitespace-nowrap rounded-md px-1 py-0.5 leading-4 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                >
                  /
                </button>
                {pathSegments.map((segment, index) => {
                  const segmentPath = `/${pathSegments.slice(0, index + 1).join("/")}`
                  const isLastSegment = index === pathSegments.length - 1
                  const isFileName = isEditorOpen && isLastSegment

                  return (
                    <div key={index} className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          if (isFileName) {
                            return
                          }
                          startTransition(() => {
                            onNavigate(segmentPath)
                          })
                        }}
                        className={cn(
                          "shrink-0 whitespace-nowrap rounded-md px-1 py-0.5 leading-4 transition-all duration-200",
                          isFileName
                            ? "font-semibold text-primary cursor-default"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {segment}
                      </button>
                      {index < pathSegments.length - 1 && <span className="text-muted-foreground/70">/</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {terminalPathActions && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => void terminalPathActions.onCopy()}
              title={tSftp("terminalCopyPath")}
            >
              <Clipboard className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={terminalPathActions.onInsert}
              title={tSftp("terminalInsertPath")}
            >
              <CornerDownRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={terminalPathActions.onEnter}
              title={tSftp("terminalChangeDirectory")}
            >
              <FolderInput className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onCreateBackgroundUpload && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onCreateBackgroundUpload}
            title={tSftp("backgroundUploadTooltip")}
          >
            <CloudUpload className="h-3.5 w-3.5" />
          </Button>
        )}

        {showTransferTasks && (
          <TransferTaskPanel
            transferTasks={transferTasks}
            backgroundTransferJobs={backgroundTransferJobs}
            onClearCompletedTransfers={onClearCompletedTransfers}
            onCancelTransfer={onCancelTransfer}
            onCancelBackgroundTransfer={onCancelBackgroundTransfer}
            onDeleteBackgroundTransfer={onDeleteBackgroundTransfer}
            onDownloadBackgroundArtifact={onDownloadBackgroundArtifact}
          />
        )}

        {showActivityLogPane ? <ActivityLogPane compact /> : null}

        {onToggleFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:scale-105 hover:bg-accent hover:text-accent-foreground"
            onClick={onToggleFullscreen}
            title={isFullscreen ? tSftp("fullscreenExit") : tSftp("fullscreen")}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={onDisconnect}
          title={tSftp("close")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
