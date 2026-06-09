
import { startTransition } from "react"
import { ChevronLeft, ChevronRight, CloudUpload, Home, LayoutGrid, List, Maximize2, Minimize2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { TransferTaskPanel } from "@/components/sftp/transfer-task-panel"
import { ActivityLogPane } from "@/components/ssh-workspace/activity-log-pane"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import type { TransferJob } from "@/lib/api/transfer-jobs"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"

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

  viewMode: "grid" | "list"
  onViewModeChange: (mode: "grid" | "list") => void
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
  viewMode,
  onViewModeChange,
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
    <div className="border-b text-sm flex items-center justify-between px-3 py-1.5">
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
                  className="h-7 text-xs font-mono pl-8 pr-3 py-1 border-0 bg-muted placeholder:text-muted-foreground"
                />
              </>
            ) : (
              <div
                onClick={() => {
                  onPathInputValueChange(displayPath)
                  onEditingPathChange(true)
                }}
                className={cn(
                  "h-7 flex items-center gap-1 pl-8 pr-3 py-1 border-0 bg-muted",
                  "text-xs font-mono cursor-text rounded-md overflow-x-auto scrollbar-custom",
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
                  className="px-1.5 py-0.5 rounded-md whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200"
                >
                  /
                </button>
                {pathSegments.map((segment, index) => {
                  const segmentPath = `/${pathSegments.slice(0, index + 1).join("/")}`
                  const isLastSegment = index === pathSegments.length - 1
                  const isFileName = isEditorOpen && isLastSegment

                  return (
                    <div key={index} className="flex items-center gap-1">
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
                          "px-1.5 py-0.5 rounded-md whitespace-nowrap transition-all duration-200",
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
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-md transition-all duration-200",
            viewMode === "grid"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            startTransition(() => {
              onViewModeChange("grid")
            })
          }}
          title={tSftp("viewGridTooltip")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-md transition-all duration-200",
            viewMode === "list"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            startTransition(() => {
              onViewModeChange("list")
            })
          }}
          title={tSftp("viewListTooltip")}
        >
          <List className="h-3.5 w-3.5" />
        </Button>

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

        <ActivityLogPane compact />

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
