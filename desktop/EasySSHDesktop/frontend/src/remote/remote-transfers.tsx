import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, ListChecks, RefreshCw, X } from "lucide-react"
import { Button } from "@easyssh/app/components/ui/button"
import { ConfirmDialog } from "@easyssh/app/components/ui/confirm-dialog"
import {
  TransferListPopover,
  TransferListRow,
  TransferRowAction,
  type TransferRowTone,
} from "@easyssh/app/components/sftp/transfer-list"
import { withServerConnection } from "@easyssh/app/lib/api/connections"
import { formatBytesString } from "@easyssh/app/lib/format-utils"
import type { SshWorkspaceTransferManager } from "@easyssh/app/lib/session/workspace"
import { openWorkspaceTask } from "@easyssh/app/lib/workspace-task-navigation"
import { toast } from "sonner"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import {
  DesktopRemoteTransferListInput,
  type DesktopRemoteTransfer,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"

const PAGE_SIZE = 30

// 状态取值由桌面服务写入，见 desktopremotetransfer.go 与 desktopremotefileio.go。
const active = (status: string) => status === "running" || status === "canceling"

function transferTone(status: string): TransferRowTone {
  switch (status) {
    case "running":
    case "canceling":
      return "running"
    case "succeeded":
      return "completed"
    case "canceled":
      return "cancelled"
    case "failed":
      return "failed"
    case "unknown":
      return "unknown"
    default:
      return "pending"
  }
}

export function useRemoteTransfers() {
  const { t } = useTranslation("sharing")
  const [items, setItems] = useState<DesktopRemoteTransfer[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  // 同名文件夹已存在、等待确认合并的上传；本机选择在确认或取消前保持有效。
  const pendingMerge = useRef<{ connection: string; selection: string; target: string } | null>(null)
  const [mergeName, setMergeName] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const result = await Remote.ListFileTransfers(
      new DesktopRemoteTransferListInput({ page, page_size: PAGE_SIZE }),
    )
    setItems(result.items)
    setTotal(result.total)
    setError("")
  }, [page])
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)))
  }, [refresh])
  // 进行中时持续刷新，面板关闭时角标也保持准确。
  useEffect(() => {
    if (!items.some((item) => active(item.status))) return
    const timer = setTimeout(() => {
      void refresh().catch((e) => setError(String(e)))
    }, 1500)
    return () => clearTimeout(timer)
  }, [items, refresh])
  const act = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      try {
        await fn()
        setOpen(true)
        await refresh()
      } catch (e) {
        toast.error(String(e))
        setError(String(e))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )
  const manager = useMemo<SshWorkspaceTransferManager>(
    () => ({
      tasks: [],
      downloadFile: (serverId, path) =>
        act(async () => {
          await withServerConnection(serverId, "files", (id) =>
            Remote.StartFileDownload(id, path),
          )
        }),
      batchDownload: (serverId, paths) =>
        act(async () => {
          // Each native save dialog authorizes one local destination.
          for (const path of paths)
            await withServerConnection(serverId, "files", (id) =>
              Remote.StartFileDownload(id, path),
            )
        }),
      uploadFile: async () => {
        throw new Error(t("nativeUploadHint"))
      },
      uploadFolder: async () => {
        throw new Error(t("nativeUploadHint"))
      },
    }),
    [act, t],
  )
  const upload = (serverId: string, path: string, canUploadFolder: boolean) => (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            await withServerConnection(serverId, "files", async (connection) => {
              const selected = await Remote.ChooseUploadFile(connection)
              try {
                await Remote.StartFileUpload(
                  connection,
                  selected.id,
                  `${path.replace(/\/$/, "")}/${selected.name}`,
                )
              } finally {
                await Remote.DiscardUploadFile(selected.id).catch(() => undefined)
              }
            })
          })
        }
      >
        {t("nativeUpload")}
      </Button>
      {canUploadFolder && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await withServerConnection(serverId, "files", async (connection) => {
                const selected = await Remote.ChooseUploadFolder(connection)
                const target = `${path.replace(/\/$/, "")}/${selected.name}`
                if (selected.skipped) toast.warning(t("nativeUploadFolderSkipped", { count: selected.skipped }))
                let keep = false
                try {
                  await Remote.StartFolderUpload(connection, selected.id, target, false)
                } catch (error) {
                  if (!String(error).includes("target_exists")) throw error
                  // 本机选择保留到用户确认或取消合并。
                  keep = true
                  pendingMerge.current = { connection, selection: selected.id, target }
                  setMergeName(selected.name)
                } finally {
                  if (!keep) await Remote.DiscardUploadFile(selected.id).catch(() => undefined)
                }
              })
            })
          }
        >
          {t("nativeUploadFolder")}
        </Button>
      )}
    </>
  )
  const takePendingMerge = () => {
    const pending = pendingMerge.current
    pendingMerge.current = null
    setMergeName(null)
    return pending
  }
  const mergeDialog = (
    <ConfirmDialog
      open={mergeName !== null}
      onOpenChange={(open) => {
        if (open) return
        // 确认时已取走待合并的选择，这里只释放被取消的选择。
        const pending = takePendingMerge()
        if (pending) void Remote.DiscardUploadFile(pending.selection).catch(() => undefined)
      }}
      title={t("nativeUploadFolderMergeTitle")}
      description={t("nativeUploadFolderMergeDescription", { name: mergeName ?? "" })}
      confirmText={t("nativeUploadFolderMergeConfirm")}
      onConfirm={() => {
        const pending = takePendingMerge()
        if (!pending) return
        void act(async () => {
          try {
            await Remote.StartFolderUpload(pending.connection, pending.selection, pending.target, true)
          } finally {
            await Remote.DiscardUploadFile(pending.selection).catch(() => undefined)
          }
        })
      }}
    />
  )
  const activeCount = items.filter((item) => active(item.status)).length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const panel = (
    <TransferListPopover
      title={t("nativeTransfers")}
      showLabel
      activeCount={activeCount}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void refresh().catch((e) => setError(String(e)))
      }}
      notice={error && <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">{error}</p>}
      empty={t("nativeTransfersEmpty")}
      items={items.map((item) => {
        const running = active(item.status)
        const known = item.total > 0
        const progress = known ? Math.min(100, Math.round((item.transferred / item.total) * 100)) : 0
        return (
          <TransferListRow
            key={item.id}
            type={item.kind === "upload" ? "upload" : "download"}
            typeLabel={t(`transferKind.${item.kind}`, { defaultValue: item.kind })}
            name={item.name}
            location={item.remote_path}
            tone={transferTone(item.status)}
            progress={running && known ? progress : undefined}
            status={running && known && item.status !== "canceling"
              ? `${progress}%`
              : t(`transferStatus.${item.status}`, { defaultValue: item.status })}
            meta={known
              ? `${formatBytesString(item.transferred, 1)} / ${formatBytesString(item.total, 1)}`
              : item.transferred > 0 ? formatBytesString(item.transferred, 1) : undefined}
            error={item.status === "failed" || item.status === "unknown" ? item.error : undefined}
            actions={(
              <>
                {item.kind === "upload" && item.status === "unknown" && item.source_task_id && (
                  <TransferRowAction label={t("verifyTransfer")} disabled={busy} onClick={() => void act(async () => {
                    await Remote.RefreshFileTransfer(item.id)
                  })}>
                    <RefreshCw className="size-3.5" />
                  </TransferRowAction>
                )}
                {!running && item.source_task_id && (
                  <TransferRowAction label={t("viewTask")} onClick={() => void Remote.GetRemoteTransfer(item.source_task_id!)
                    .then((job) => {
                      if (job.task_run_id) {
                        setOpen(false)
                        openWorkspaceTask(job.task_run_id)
                      }
                    })
                    .catch((e) => setError(String(e)))}
                  >
                    <ListChecks className="size-3.5" />
                  </TransferRowAction>
                )}
                <TransferRowAction
                  label={t(running ? "cancel" : "dismiss")}
                  destructive
                  disabled={busy || item.status === "canceling"}
                  onClick={() => void act(async () => {
                    await (running ? Remote.CancelFileTransfer(item.id) : Remote.DismissFileTransfer(item.id))
                  })}
                >
                  <X className="size-3.5" />
                </TransferRowAction>
              </>
            )}
          />
        )
      })}
      footer={pages > 1 && (
        <div className="flex items-center justify-end gap-1 border-t px-1.5 py-1 text-xs text-muted-foreground">
          <span className="mr-1 tabular-nums">{page} / {pages}</span>
          <TransferRowAction label={t("previous")} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-3.5" />
          </TransferRowAction>
          <TransferRowAction label={t("next")} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-3.5" />
          </TransferRowAction>
        </div>
      )}
    />
  )
  return { manager, upload, panel: <>{panel}{mergeDialog}</> }
}
