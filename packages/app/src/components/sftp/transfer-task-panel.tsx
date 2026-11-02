import { useMemo } from "react"
import { ListChecks, RotateCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TransferListPopover, TransferListRow, TransferRowAction, type TransferRowTone } from "@/components/sftp/transfer-list"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { formatBytesString } from "@/lib/format-utils"
import { isTransferTaskActiveStatus, type TransferTaskActions } from "@/lib/session/transfer-controller"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"

const typeLabelKeys = {
  upload: "transferTypeUpload",
  download: "transferTypeDownload",
  transfer: "transferTypeTransfer",
} as const

function taskTone(task: WorkspaceTransferTask): TransferRowTone {
  switch (task.status) {
    case "pending":
    case "completed":
    case "failed":
    case "cancelled":
    case "unknown":
      return task.status
    default:
      return "running"
  }
}

function TransferTaskItem({ task, transfers }: { task: WorkspaceTransferTask; transfers: TransferTaskActions }) {
  const tSftp = useWorkspaceSftpTranslator()
  const tone = taskTone(task)
  const active = isTransferTaskActiveStatus(task.status)
  const running = tone === "running"
  const progress = Math.min(100, Math.max(0, Math.round(task.progress || 0)))

  const status = (() => {
    switch (tone) {
      case "pending":
        return tSftp("transferStatusPending")
      case "completed":
        return tSftp("transferStatusCompleted")
      case "failed":
        return tSftp("transferStatusFailed")
      case "cancelled":
        return tSftp("transferStatusCancelled")
      case "unknown":
        return tSftp("transferUnknownHint")
      default:
        return [
          `${progress}%`,
          task.speed,
          task.timeRemaining ? tSftp("transferRemaining", { time: task.timeRemaining }) : undefined,
        ].filter(Boolean).join(" · ")
    }
  })()

  const size = running && task.fileSizeBytes > 0 && task.bytesTransferred !== undefined
    ? `${formatBytesString(task.bytesTransferred, 1)} / ${task.fileSize}`
    : task.fileSize !== "-" ? task.fileSize : ""

  return (
    <TransferListRow
      type={task.type}
      typeLabel={tSftp(typeLabelKeys[task.type])}
      name={task.fileName}
      location={task.type === "transfer" && task.sourceServer && task.targetServer
        ? `${task.sourceServer} → ${task.targetServer} · ${task.remotePath ?? ""}`
        : task.resultPath || task.remotePath}
      tone={tone}
      progress={running ? progress : undefined}
      status={status}
      meta={[
        task.filesTotal && task.filesTotal > 1 ? tSftp("transferFiles", { done: task.filesCompleted ?? 0, total: task.filesTotal }) : "",
        size,
      ].filter(Boolean).join(" · ")}
      error={tone === "failed" || tone === "unknown" ? task.error : undefined}
      actions={(
        <>
          {tone === "failed" && task.retryable && transfers.retry && (
            <TransferRowAction label={tSftp("transferRetry")} onClick={() => void transfers.retry?.(task.id)}>
              <RotateCw className="size-3.5" />
            </TransferRowAction>
          )}
          {!active && task.taskRunId && (
            <TransferRowAction label={tSftp("viewOperationTask")} onClick={() => openWorkspaceTask(task.taskRunId!)}>
              <ListChecks className="size-3.5" />
            </TransferRowAction>
          )}
          <TransferRowAction
            label={tSftp(active ? "transferCancel" : "transferRemove")}
            destructive
            onClick={() => (active ? transfers.cancel(task.id) : transfers.remove(task.id))}
          >
            <X className="size-3.5" />
          </TransferRowAction>
        </>
      )}
    />
  )
}

export function TransferTaskPanel({ transfers }: { transfers: TransferTaskActions }) {
  const tSftp = useWorkspaceSftpTranslator()
  // 进行中的任务在前，各组内新任务在前。
  const tasks = useMemo(() => {
    const newestFirst = [...transfers.tasks].reverse()
    return [
      ...newestFirst.filter((task) => isTransferTaskActiveStatus(task.status)),
      ...newestFirst.filter((task) => !isTransferTaskActiveStatus(task.status)),
    ]
  }, [transfers.tasks])
  const activeCount = tasks.filter((task) => isTransferTaskActiveStatus(task.status)).length
  const settledTasks = tasks.slice(activeCount)

  return (
    <TransferListPopover
      title={tSftp("transferPanelTitle")}
      activeCount={activeCount}
      empty={tSftp("transferPanelEmpty")}
      headerAction={settledTasks.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => settledTasks.forEach((task) => transfers.remove(task.id))}
        >
          {tSftp("transferPanelClearCompleted")}
        </Button>
      )}
      items={tasks.map((task) => <TransferTaskItem key={task.id} task={task} transfers={transfers} />)}
    />
  )
}
