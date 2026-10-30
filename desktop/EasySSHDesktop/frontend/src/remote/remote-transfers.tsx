import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@easyssh/app/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@easyssh/app/components/ui/dialog"
import { withServerConnection } from "@easyssh/app/lib/api/connections"
import type { SshWorkspaceTransferManager } from "@easyssh/app/lib/session/workspace"
import { openWorkspaceTask } from "@easyssh/app/lib/workspace-task-navigation"
import { toast } from "sonner"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import {
  DesktopRemoteTransferListInput,
  type DesktopRemoteTransfer,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"

const active = (s: string) =>
  ["queued", "running", "canceling", "created", "transferring"].includes(s)
export function useRemoteTransfers() {
  const { t } = useTranslation("sharing")
  const [items, setItems] = useState<DesktopRemoteTransfer[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const result = await Remote.ListFileTransfers(
      new DesktopRemoteTransferListInput({ page, page_size: 30 }),
    )
    setItems(result.items)
    setTotal(result.total)
    setError("")
  }, [page])
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)))
  }, [refresh])
  useEffect(() => {
    if (!open || !items.some((item) => active(item.status))) return
    const timer = setTimeout(() => {
      void refresh().catch((e) => setError(String(e)))
    }, 1500)
    return () => clearTimeout(timer)
  }, [items, open, refresh])
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
    }),
    [act, t],
  )
  const upload = (serverId: string, path: string) => (
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
  )
  const panel = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true)
          void refresh().catch((e) => setError(String(e)))
        }}
      >
        {t("nativeTransfers")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("nativeTransfers")}</DialogTitle>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            variant="ghost"
            onClick={() => void refresh().catch((e) => setError(String(e)))}
          >
            {t("refresh")}
          </Button>
          {items.map((item) => (
            <div className="space-y-2 rounded border p-3 text-sm" key={item.id}>
              <p>{item.name}</p>
              <p className="break-all text-xs text-muted-foreground">
                {item.remote_path}
              </p>
              <p>
                {t(`transferStatus.${item.status}`, {
                  defaultValue: item.status,
                })}{" "}
                · {item.transferred.toLocaleString()} /{" "}
                {item.total < 0 ? "—" : item.total.toLocaleString()} B
              </p>
              {item.error && <p className="text-destructive">{item.error}</p>}
              <div className="flex gap-2">
                {item.status === "unknown" && (
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(async () => {
                        await Remote.RefreshFileTransfer(item.id)
                      })
                    }
                  >
                    {t("verifyTransfer")}
                  </Button>
                )}
                {item.source_task_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void Remote.GetRemoteTransfer(item.source_task_id!)
                        .then((job) => {
                          if (job.task_run_id) {
                            setOpen(false)
                            openWorkspaceTask(job.task_run_id)
                          }
                        })
                        .catch((e) => setError(String(e)))
                    }
                  >
                    {t("viewTask")}
                  </Button>
                )}
                {active(item.status) ? (
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(async () => {
                        await Remote.CancelFileTransfer(item.id)
                      })
                    }
                  >
                    {t("cancel")}
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void act(async () => {
                        await Remote.DismissFileTransfer(item.id)
                      })
                    }
                  >
                    {t("dismiss")}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              {t("previous")}
            </Button>
            <Button
              disabled={page * 30 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
  return { manager, upload, panel }
}
