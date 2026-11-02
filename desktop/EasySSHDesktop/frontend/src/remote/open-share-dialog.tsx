import { useConfirmDialog } from "@easyssh/app/hooks/use-confirm-dialog"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@easyssh/app/components/ui/button"
import { Input } from "@easyssh/app/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@easyssh/app/components/ui/dialog"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import type {
  DesktopRemoteWorkspace,
  DesktopIncomingLaunch,
  DesktopHandoffPending,
} from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"

export function OpenShareDialog({ open, onOpenChange: setOpen }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("sharing")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [link, setLink] = useState("")
  const [recent, setRecent] = useState<DesktopRemoteWorkspace[]>([])
  const [launches, setLaunches] = useState<DesktopIncomingLaunch[]>([])
  const [handoffs, setHandoffs] = useState<DesktopHandoffPending[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const [recent, incoming, pending] = await Promise.all([
      Remote.List(),
      Remote.PendingLaunches(),
      Remote.PendingHandoffs(),
    ])
    setRecent(recent)
    setLaunches(incoming)
    setHandoffs(pending)
    if (incoming.length || pending.length) setOpen(true)
  }, [setOpen])
  useEffect(() => {
    if (open) void refresh().catch((e) => setError(String(e)))
  }, [open, refresh])
  useEffect(() => {
    const receive = () => {
      void refresh().catch((e) => setError(String(e)))
    }
    receive()
    window.addEventListener("focus", receive)
    // The native launch inbox has a pull API. Read only while the local window is visible.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") receive()
    }, 5000)
    return () => {
      window.removeEventListener("focus", receive)
      clearInterval(timer)
    }
  }, [refresh])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) setLink("")
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("openSharedLink")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("desktopScopeHint")}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const raw = link.trim()
              setLink("")
              void act(async () => {
                await Remote.OpenShare(raw)
              })
            }}
          >
            <Input
              required
              autoComplete="off"
              type="password"
              placeholder={t("shareLink")}
              aria-label={t("shareLink")}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <Button disabled={busy || !link.trim()} type="submit">
              {t("open")}
            </Button>
          </form>
          {launches.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p className="break-all text-sm">
                {t("incomingFrom", { origin: item.origin })}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await Remote.BeginHandoff(item.origin, item.handoff_id)
                      await Remote.DismissLaunch(item.id)
                    })
                  }
                >
                  {t("receive")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await Remote.DismissLaunch(item.id)
                    })
                  }
                >
                  {t("dismiss")}
                </Button>
              </div>
            </div>
          ))}
          {handoffs.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p className="break-all text-sm">{item.origin}</p>
              <p className="font-mono text-xl tracking-widest">
                {item.confirmation}
              </p>
              <p className="text-xs text-muted-foreground">{t("claimHint")}</p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await Remote.ClaimHandoff(item.id)
                    })
                  }
                >
                  {t("claim")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await Remote.CancelHandoff(item.id)
                    })
                  }
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ))}
          <h3 className="text-sm font-medium">{t("recentShares")}</h3>
          {recent.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded border p-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p>{item.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.origin}
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await Remote.OpenRecent(item.id)
                  })
                }
              >
                {t("open")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void act(async () => {
                    if (!await confirm({ description: t("forgetConfirm"), variant: "destructive" })) return
                    await Remote.Forget(item.id)
                  })
                }}
              >
                {t("forget")}
              </Button>
            </div>
          ))}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  )
}
