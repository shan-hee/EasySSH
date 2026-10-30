import { GrantResourcesEditor } from "./grant-resources-editor"
import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  grantsApi,
  type Grant,
  type GrantDetail,
  type GrantInput,
} from "@/lib/api/grants"
import { serversApi } from "@/lib/api/servers"
import type { Server } from "@/lib/server-types"
import { scriptsApi } from "@/lib/api/scripts"
import type { Script } from "@/lib/script-types"
import { apiFetch } from "@/lib/api-client"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const fresh = (server?: Server): GrantInput => ({
  name: server?.name || "",
  default_content: "terminal",
  max_sessions: 3,
  max_connections: 4,
  resources: server
    ? [
        {
          server_id: server.id,
          actions: ["terminal.connect"],
          allow_interactive: false,
        },
      ]
    : [],
})

export function GrantManager({
  server,
  compact = false,
  grantId,
  triggerClassName,
}: {
  server?: Server
  compact?: boolean
  grantId?: string
  triggerClassName?: string
}) {
  const { t } = useTranslation("sharing")
  const [open, setOpen] = useState(false)
  const [reviewServer, setReviewServer] = useState("")
  useEffect(() => {
    if (server || grantId) return
    const review = (event: Event) => {
      setReviewServer(
        (event as CustomEvent<{ serverId?: string }>).detail?.serverId ?? "",
      )
      setOpen(true)
    }
    window.addEventListener("easyssh:review-sharing", review)
    return () => window.removeEventListener("easyssh:review-sharing", review)
  }, [server, grantId])
  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        className={cn(
          compact &&
            "h-8 w-8 p-0 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent",
          triggerClassName,
        )}
        title={t("share")}
        aria-label={t("share")}
        onClick={() => setOpen(true)}
      >
        <Share2 className="h-4 w-4" />
        {!compact && t("manage")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{t("manage")}</DialogTitle>
          </DialogHeader>
          {open && (
            <GrantManagerContent
              initialServer={server}
              initialGrantId={grantId}
              reviewServer={reviewServer}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function GrantManagerContent({
  initialServer,
  initialGrantId,
  reviewServer,
}: {
  initialServer?: Server
  initialGrantId?: string
  reviewServer?: string
}) {
  const { t } = useTranslation("sharing")
  const formId = useId()
  const [items, setItems] = useState<Grant[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [servers, setServers] = useState<Server[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [catalogReady, setCatalogReady] = useState(false)
  const [catalogRequest, setCatalogRequest] = useState(0)
  const [detail, setDetail] = useState<GrantDetail | null>(null)
  const [form, setForm] = useState<GrantInput | null>(() =>
    initialServer ? fresh(initialServer) : null,
  )
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const loadList = async () => {
    if (!reviewServer) return grantsApi.list(offset)
    const matched: Grant[] = []
    for (let start = 0; ; start += 30) {
      const page = await grantsApi.list(start)
      const details = await Promise.all(
        page.items
          .filter((g) => !g.revoked_at)
          .map((g) => grantsApi.detail(g.id)),
      )
      matched.push(
        ...details
          .filter((d) => d.resources.some((r) => r.id === reviewServer))
          .map((d) => d.grant),
      )
      if (start + page.items.length >= page.total || !page.items.length) break
    }
    return { items: matched.slice(offset, offset + 30), total: matched.length }
  }
  const refresh = async () => {
    const result = await loadList()
    setItems(result.items)
    setTotal(result.total)
  }
  useEffect(() => {
    let active = true
    loadList()
      .then((r) => {
        if (active) {
          setItems(r.items)
          setTotal(r.total)
        }
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [offset, reviewServer])
  useEffect(() => {
    let active = true
    void (async () => {
      const all: Server[] = []
      const allScripts: Script[] = []
      for (let page = 1; ; page++) {
        const r = await serversApi.list({ page, limit: 100 })
        all.push(...r.data)
        if (!r.data.length || all.length >= r.total) break
      }
      for (let page = 1; ; page++) {
        const r = await scriptsApi.list({ page, limit: 100 })
        allScripts.push(...r.data)
        if (!r.data.length || allScripts.length >= r.total) break
      }
      if (active) {
        setServers(all)
        setScripts(allScripts)
        setCatalogReady(true)
      }
    })().catch((e) => {
      if (active) setError(String(e))
    })
    return () => {
      active = false
    }
  }, [catalogRequest])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const inspect = (id: string) =>
    run(async () => {
      setDetail(await grantsApi.detail(id))
      setForm(null)
      setLink("")
    })
  const edit = () => {
    if (!detail) return
    const g = detail.grant
    setForm({
      name: g.name,
      default_content: g.default_content as GrantInput["default_content"],
      expires_at: g.expires_at,
      long_lived: !g.expires_at,
      max_sessions: g.max_sessions,
      max_connections: g.max_connections,
      upload_limit: g.upload_limit,
      download_limit: g.download_limit,
      ai_request_limit: g.ai_request_limit,
      resources: detail.resources.map((r) => ({
        server_id: r.id,
        actions: r.actions,
        scripts: detail.scripts
          .filter((s) => s.server_id === r.id)
          .map(({ script_id, version, parameters }) => ({
            script_id,
            version,
            parameters,
          })),
      })),
    })
  }
  useEffect(() => {
    if (initialGrantId) void inspect(initialGrantId)
  }, [initialGrantId])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">
        {reviewServer && (
          <p className="text-xs text-muted-foreground">{t("affectedHint")}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("originHint")}{" "}
          <a
            className="underline"
            href="/dashboard/settings?section=basic"
            target="_blank"
            rel="noreferrer"
          >
            {t("configureOrigin")}
          </a>
        </p>
        {error && (
          <p
            role="alert"
            className="rounded border border-destructive p-3 text-sm text-destructive"
          >
            {error}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setCatalogRequest((value) => value + 1)
                void run(refresh)
              }}
            >
              {t("refresh")}
            </Button>
          </p>
        )}
        {link && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm">{t("linkOnce")}</p>
            <Input readOnly value={link} aria-label={t("shareLink")} />
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => toast.success(t("copied")))
                  .catch(() => setError(t("copyFailed")))
              }
            >
              {t("copy")}
            </Button>
          </div>
        )}
        {!form && (
          <div className="flex flex-wrap gap-2">
            {detail && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDetail(null)
                  setLink("")
                }}
              >
                {t("backToShares")}
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                setDetail(null)
                setForm(fresh(initialServer))
                setLink("")
              }}
            >
              {t("create")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              {t("refresh")}
            </Button>
          </div>
        )}
        {!form && !detail && (
          <div className="space-y-2">
            {items.map((g) => (
              <button
                key={g.id}
                disabled={busy}
                className="flex w-full items-center justify-between rounded border p-3 text-left text-sm hover:bg-accent"
                onClick={() => void inspect(g.id)}
              >
                <span>{g.name}</span>
                <span className="text-muted-foreground">
                  {g.revoked_at
                    ? t("revoked")
                    : g.expires_at
                      ? new Date(g.expires_at).toLocaleString()
                      : t("longLived")}
                </span>
              </button>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                {t("previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={offset + items.length >= total || busy}
                onClick={() => setOffset(offset + 30)}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        )}
        {detail && !form && (
          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="font-medium">{detail.grant.name}</h3>
            <p className="text-sm">
              {t("usage", {
                upload: detail.grant.uploaded_bytes,
                download: detail.grant.downloaded_bytes,
                ai: detail.grant.ai_requests,
              })}
            </p>
            {detail.resources.map((r) => (
              <div key={r.id} className="rounded border p-2 text-sm">
                <div>
                  {r.name} · {r.username}@{r.host}:{r.port}
                </div>
                <div className="text-muted-foreground">
                  {r.actions.map((a) => t(`actions.${a}`)).join(" · ")}
                </div>
                {r.paused && (
                  <div className="mt-2 flex items-center gap-2">
                    <span>{t("paused")}</span>
                    <Button
                      size="sm"
                      disabled={busy || !!detail.grant.revoked_at}
                      onClick={() =>
                        void run(async () => {
                          const current = await apiFetch<{
                            connection_revision: number
                            host: string
                            port: number
                            username: string
                          }>(`/servers/${r.id}`)
                          if (!Number.isInteger(current.connection_revision))
                            throw new Error(t("revisionUnavailable"))
                          if (
                            !window.confirm(
                              t("confirmResource", {
                                identity: `${current.username}@${current.host}:${current.port}`,
                              }),
                            )
                          )
                            return
                          await grantsApi.confirm(
                            detail.grant.id,
                            r.id,
                            current.connection_revision,
                          )
                          setDetail(await grantsApi.detail(detail.grant.id))
                        })
                      }
                    >
                      {t("confirm")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!detail.grant.revoked_at && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={edit}>
                  {t("edit")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t("rotateConfirm")))
                      void run(async () => {
                        const r = await grantsApi.rotate(detail.grant.id)
                        setLink(r.link)
                        setDetail(await grantsApi.detail(r.grant.id))
                        await refresh()
                      })
                  }}
                >
                  {t("rotate")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t("revokeConfirm")))
                      void run(async () => {
                        await grantsApi.revoke(detail.grant.id)
                        setDetail(await grantsApi.detail(detail.grant.id))
                        setLink("")
                        await refresh()
                      })
                  }}
                >
                  {t("revoke")}
                </Button>
              </div>
            )}
            <h4 className="text-sm font-medium">{t("sessions")}</h4>
            {detail.sessions.map((s) => (
              <div
                className="flex items-center justify-between gap-2 text-sm"
                key={s.id}
              >
                <span>
                  {s.client_kind} · {new Date(s.last_seen_at).toLocaleString()}{" "}
                  ·{" "}
                  {s.revoked_at
                    ? t("revoked")
                    : t("expires", {
                        date: new Date(s.expires_at).toLocaleString(),
                      })}
                </span>
                {!s.revoked_at && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await grantsApi.endSession(s.id)
                        setDetail(await grantsApi.detail(detail.grant.id))
                      })
                    }
                  >
                    {t("endSession")}
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
        {form && (
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const missingInteractive = form.resources.find(
                  (r) => r.allow_interactive === undefined,
                )
                if (missingInteractive)
                  throw new Error(
                    t("interactiveRequired", {
                      name:
                        servers.find(
                          (s) => s.id === missingInteractive.server_id,
                        )?.name || missingInteractive.server_id,
                    }),
                  )
                if (
                  form.resources.some(
                    (r) =>
                      !r.actions.includes(
                        (
                          {
                            terminal: "terminal.connect",
                            files: "files.list",
                            monitor: "monitor.read",
                            docker: "docker.read",
                          } as const
                        )[form.default_content ?? "terminal"],
                      ),
                  )
                )
                  throw new Error(t("landingRequired"))
                if (
                  form.resources.some((r) => r.actions.includes("ai.use")) &&
                  form.ai_request_limit == null
                )
                  throw new Error(t("aiQuotaRequired"))
                if (detail) {
                  if (!window.confirm(t("editConfirm"))) return
                  await grantsApi.update(
                    detail.grant.id,
                    detail.grant.version,
                    form,
                  )
                  setDetail(await grantsApi.detail(detail.grant.id))
                } else {
                  const r = await grantsApi.create(form)
                  setLink(r.link)
                  setDetail(await grantsApi.detail(r.grant.id))
                }
                setForm(null)
                await refresh()
              })
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                {t("name")}
                <Input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                {t("landing")}
                <Select
                  value={form.default_content}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      default_content: value as GrantInput["default_content"],
                    })
                  }
                >
                  <SelectTrigger className="w-full" aria-label={t("landing")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["terminal", "files", "monitor", "docker"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!form.long_lived}
                onCheckedChange={(checked) =>
                  setForm({
                    ...form,
                    long_lived: checked === true,
                    expires_at: null,
                  })
                }
              />{" "}
              {t("longLived")}
            </label>
            {!form.long_lived && (
              <label className="block text-sm">
                {t("expiryHint")}
                <Input
                  type="datetime-local"
                  className="dark:[color-scheme:dark]"
                  value={
                    form.expires_at
                      ? (() => {
                          const d = new Date(form.expires_at)
                          return new Date(
                            d.getTime() - d.getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        })()
                      : ""
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      expires_at: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </label>
            )}
            <GrantResourcesEditor
              servers={servers}
              scripts={scripts}
              value={form.resources}
              defaultContent={form.default_content}
              disabled={!catalogReady || busy}
              loading={!catalogReady}
              onChange={(resources) => setForm({ ...form, resources })}
            />
            <details className="rounded border p-3">
              <summary className="cursor-pointer text-sm">
                {t("limits")}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    "max_sessions",
                    "max_connections",
                    "upload_limit",
                    "download_limit",
                    "ai_request_limit",
                  ] as const
                ).map((k) => (
                  <label key={k} className="text-sm">
                    {t(k)}
                    <Input
                      type="number"
                      min={k.startsWith("max_") ? 1 : 0}
                      max={k.startsWith("max_") ? 100 : Number.MAX_SAFE_INTEGER}
                      step={1}
                      value={form[k] ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          [k]:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </form>
        )}
      </div>
      {form && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3">
          <span className="text-xs text-muted-foreground">
            {t("selectedResourceCount", { count: form.resources.length })}
          </span>
          <div className="flex gap-2">
            <Button
              type="submit"
              form={formId}
              disabled={busy || !catalogReady || !form.resources.length}
            >
              {busy ? t("saving") : t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
