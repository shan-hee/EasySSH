import { Activity, CheckCircle2, Download, Loader2, Trash2, Upload, X, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { formatBytesString, formatSpeed } from "@/lib/format-utils"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { UploadProgressItem } from "@/components/sftp/upload-progress-item"
import type { TransferJob } from "@/lib/api/transfer-jobs"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"

export interface TransferTaskPanelProps {
  transferTasks: WorkspaceTransferTask[]
  backgroundTransferJobs?: TransferJob[]
  onClearCompletedTransfers?: () => void
  onCancelTransfer?: (taskId: string) => void
  onCancelBackgroundTransfer?: (jobId: string) => void
  onDeleteBackgroundTransfer?: (jobId: string) => void
  onDownloadBackgroundArtifact?: (jobId: string) => void
}

const activeBackgroundStatuses = new Set(["staging", "queued", "running"])
const removableBackgroundStatuses = new Set(["created", "completed", "failed", "cancelled", "expired"])

function getBackgroundStatusLabel(job: TransferJob) {
  switch (job.status) {
    case "created":
      return "已暂存"
    case "staging":
      return "暂存中"
    case "queued":
      return "排队中"
    case "running":
      return "传输中"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "cancelled":
      return "已取消"
    case "expired":
      return "已过期"
    default:
      return job.status
  }
}

function getBackgroundStageLabel(job: TransferJob) {
  switch (job.stage) {
    case "staging":
      return "暂存"
    case "transfer_to_remote":
      return "上传到远端"
    case "download_from_remote":
      return "从远端下载"
    case "ready_for_download":
      return "可取回"
    case "cleanup":
      return "清理"
    default:
      return job.stage
  }
}

function BackgroundTransferItem({
  job,
  onCancel,
  onDelete,
  onDownloadArtifact,
}: {
  job: TransferJob
  onCancel?: (jobId: string) => void
  onDelete?: (jobId: string) => void
  onDownloadArtifact?: (jobId: string) => void
}) {
  const isActive = activeBackgroundStatuses.has(job.status)
  const isScheduledStagedInput = job.kind === "sftp_upload" && job.status === "created" && !!job.scheduled_task_id
  const canDelete = removableBackgroundStatuses.has(job.status) && !isScheduledStagedInput
  const canDownloadArtifact = job.kind === "sftp_download" && job.status === "completed" && !!onDownloadArtifact
  const progress = Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0
  const fileSize = job.bytes_total > 0 ? formatBytesString(job.bytes_total, 1) : job.artifact_size > 0 ? formatBytesString(job.artifact_size, 1) : "-"
  const speed = job.speed_bps > 0 && isActive ? formatSpeed(job.speed_bps) : ""

  return (
    <div className="border-b px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          job.status === "completed" && "bg-emerald-500/10 text-emerald-600",
          job.status === "failed" && "bg-destructive/10 text-destructive",
          job.status === "cancelled" && "bg-muted text-muted-foreground",
          job.status === "expired" && "bg-amber-500/10 text-amber-600",
          isActive && "bg-primary/10 text-primary",
        )}>
          {job.status === "completed" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : job.status === "failed" ? (
            <XCircle className="h-4 w-4" />
          ) : isActive ? (
            <Loader2 className={cn("h-4 w-4", job.status !== "created" && "animate-spin")} />
          ) : (
            <Upload className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{job.name || job.file_name || job.artifact_name}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {job.kind === "sftp_upload" ? "后台上传" : "后台下载"} · {getBackgroundStageLabel(job)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canDownloadArtifact && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={() => onDownloadArtifact?.(job.id)}
                  title="下载产物"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
              {isActive && onCancel && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={() => onCancel(job.id)}
                  title="取消后台传输"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
              {canDelete && onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(job.id)}
                  title="删除任务记录"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            <Progress value={progress} className="h-1.5" />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{getBackgroundStatusLabel(job)} · {progress}%</span>
              <span className="shrink-0 tabular-nums">{speed ? `${speed} · ` : ""}{fileSize}</span>
            </div>
            {job.error_message && (
              <div className="line-clamp-2 text-xs text-destructive">{job.error_message}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TransferTaskPanel({
  transferTasks,
  backgroundTransferJobs = [],
  onClearCompletedTransfers,
  onCancelTransfer,
  onCancelBackgroundTransfer,
  onDeleteBackgroundTransfer,
  onDownloadBackgroundArtifact,
}: TransferTaskPanelProps) {
  const tSftp = useWorkspaceSftpTranslator()
  const effectiveTransferTasks = transferTasks
  const pendingSessionCount = effectiveTransferTasks.filter((task) => task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled").length
  const pendingBackgroundCount = backgroundTransferJobs.filter((job) => activeBackgroundStatuses.has(job.status)).length
  const pendingCount = pendingSessionCount + pendingBackgroundCount
  const totalCount = effectiveTransferTasks.length + backgroundTransferJobs.length
  const hasCompletedTasks = effectiveTransferTasks.some((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground relative",
          )}
          title={tSftp("transferPanelButtonTitle")}
        >
          <Upload className="h-3.5 w-3.5" />
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-medium flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[400px] max-h-[500px] overflow-hidden">
        <div className="px-3 py-2 flex items-center justify-between border-b">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {tSftp("transferPanelTitle", { count: totalCount })}
            </span>
          </div>
          {hasCompletedTasks && onClearCompletedTransfers && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onClearCompletedTransfers}
            >
              {tSftp("transferPanelClearCompleted")}
            </Button>
          )}
        </div>

        {totalCount > 0 ? (
          <div className="max-h-[400px] overflow-y-auto">
            {effectiveTransferTasks.length > 0 && (
              <div>
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  会话传输
                </div>
                {effectiveTransferTasks.map((task) => (
                  <UploadProgressItem
                    key={task.id}
                    task={task}
                    onCancel={onCancelTransfer}
                  />
                ))}
              </div>
            )}
            {backgroundTransferJobs.length > 0 && (
              <div>
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  后台传输
                </div>
                {backgroundTransferJobs.map((job) => (
                  <BackgroundTransferItem
                    key={job.id}
                    job={job}
                    onCancel={onCancelBackgroundTransfer}
                    onDelete={onDeleteBackgroundTransfer}
                    onDownloadArtifact={onDownloadBackgroundArtifact}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {tSftp("transferPanelEmpty")}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
