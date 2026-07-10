import type { ReactNode } from "react"
import { Columns2, FolderKanban, ListRestart, Plus, Rows2, Server, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { cn } from "@/lib/utils"

export interface SftpWorkspaceShellProps {
  sessionCount: number
  activeTransferCount: number
  completedTransferCount: number
  isSplitView: boolean
  canSplit: boolean
  onNewSession: () => void
  onToggleSplit: () => void
  onClearCompletedTransfers?: () => void
  tabBar: ReactNode
  children: ReactNode
}

/** SFTP 专用页面的顶层产品壳：显式承载多会话、双栏和任务状态。 */
export function SftpWorkspaceShell({
  sessionCount,
  activeTransferCount,
  completedTransferCount,
  isSplitView,
  canSplit,
  onNewSession,
  onToggleSplit,
  onClearCompletedTransfers,
  tabBar,
  children,
}: SftpWorkspaceShellProps) {
  const tSftp = useWorkspaceSftpTranslator()

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-2xl transition-colors",
        "border-border/60 bg-background/70 text-foreground backdrop-blur-md",
      )}
      data-sftp-product-shell="workspace"
    >
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b bg-muted/20 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{tSftp("workspaceShellTitle")}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {tSftp("workspaceShellDescription")}
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-1.5 lg:flex">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            {tSftp("workspaceSessionCount", { count: sessionCount })}
          </div>
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            {activeTransferCount > 0
              ? tSftp("workspaceActiveTransferCount", { count: activeTransferCount })
              : tSftp("workspaceNoActiveTransfers")}
          </div>
        </div>

        {completedTransferCount > 0 && onClearCompletedTransfers && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onClearCompletedTransfers}
            title={tSftp("workspaceClearCompletedTransfers")}
          >
            <ListRestart className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{tSftp("workspaceClearCompletedShort")}</span>
          </Button>
        )}
        <Button
          type="button"
          variant={isSplitView ? "secondary" : "ghost"}
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onToggleSplit}
          disabled={!canSplit && !isSplitView}
          title={isSplitView ? tSftp("workspaceExitSplit") : tSftp("workspaceEnterSplit")}
        >
          {isSplitView ? <Rows2 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">
            {isSplitView ? tSftp("workspaceExitSplitShort") : tSftp("workspaceEnterSplitShort")}
          </span>
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onNewSession}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tSftp("workspaceNewSession")}</span>
        </Button>
      </div>

      {tabBar}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
