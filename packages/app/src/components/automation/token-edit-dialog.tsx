import { useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ChevronRight, Loader2, Pencil, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { expiryDays, loadTokenSources } from "./create-token-dialog"
import { TokenAuthorizationEditor } from "./token-authorization-editor"
import type { AccessToken } from "@/lib/api/automation"
import { grantsApi, type GrantDetail } from "@/lib/api/grants"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import type { Script } from "@/lib/script-types"
import type { Server } from "@/lib/server-types"
import { draftFromGrant, tokenAuthorizationIssue, tokenResources } from "@/lib/token-authorization"
import { cn } from "@/lib/utils"

const formatTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function TokenEditDialog({ token, onClose }: { token: AccessToken | null; onClose: () => void }) {
  return (
    <Dialog open={!!token} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {token && <TokenEdit key={token.id} token={token} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function TokenEdit({ token, onDone }: { token: AccessToken; onDone: () => void }) {
  const { t } = useTranslation("automation")
  const detail = useQuery({ queryKey: queryKeys.automation.grant(token.grant_id), queryFn: () => grantsApi.detail(token.grant_id), staleTime: 0 })
  const sources = useQuery({ queryKey: queryKeys.automation.tokenSources, queryFn: loadTokenSources, staleTime: 0 })
  const header = (
    <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Pencil className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <DialogTitle className="truncate text-base">{t("edit.title", { name: token.name })}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">{t("edit.description")}</DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )
  if (detail.isSuccess && sources.isSuccess) {
    return (
      <TokenEditForm
        header={header}
        detail={detail.data}
        servers={sources.data.servers}
        scripts={sources.data.scripts}
        onDone={onDone}
      />
    )
  }
  return (
    <>
      {header}
      <div className="px-6 py-5">
        {detail.isError || sources.isError ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3.5 py-2.5 text-xs text-destructive">
            <span>{t("loadFailed")}</span>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void Promise.all([detail.refetch(), sources.refetch()])}>
              {t("retry")}
            </Button>
          </div>
        ) : (
          <PageLoading className="min-h-0 py-10" />
        )}
      </div>
    </>
  )
}

function TokenEditForm({
  header,
  detail,
  servers,
  scripts,
  onDone,
}: {
  header: ReactNode
  detail: GrantDetail
  servers: Server[]
  scripts: Script[]
  onDone: () => void
}) {
  const { t } = useTranslation("automation")
  const queryClient = useQueryClient()
  // Refetches must not pair edits from an old snapshot with a newer version.
  // Keep the version that produced the form so concurrent edits are rejected.
  const [baseline] = useState(detail)
  const { grant } = baseline
  const [{ draft: initial, uniform }] = useState(() => draftFromGrant(baseline))
  const [draft, setDraft] = useState(initial)
  const [name, setName] = useState(grant.name)
  // 0 keeps the current expiry; other values count from now, as at creation.
  const [days, setDays] = useState(0)
  const [connections, setConnections] = useState(grant.max_connections)
  const [busy, setBusy] = useState(false)
  const tokenName = name.trim()
  const nameInvalid = !tokenName || new TextEncoder().encode(tokenName).length > 100
  const issue = tokenAuthorizationIssue(draft, servers, scripts)
  const validConnections = Number.isInteger(connections) && connections >= 1 && connections <= 100
  const canSave = !busy && !issue && !nameInvalid && validConnections

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      // An update replaces the whole grant, so unchanged quotas are sent back as they are.
      await grantsApi.update(grant.id, grant.version, {
        name: tokenName,
        resources: tokenResources(draft),
        expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : grant.expires_at,
        max_sessions: grant.max_sessions,
        max_connections: connections,
        upload_limit: grant.upload_limit,
        download_limit: grant.download_limit,
        ai_request_limit: grant.ai_request_limit,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automation.grant(grant.id) }),
      ])
      toast.success(t("edit.saved"))
      onDone()
    } catch (error) {
      toast.error(getErrorMessage(error, t("edit.saveFailed")))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {!uniform && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p className="leading-5">{t("edit.nonUniform")}</p>
          </div>
        )}

        <TokenAuthorizationEditor value={draft} servers={servers} scripts={scripts} loading={false} disabled={busy} onChange={setDraft} />

        {/* 有效期与名称：一键保留/延展胶囊 + 名称输入 */}
        <section className="space-y-3.5 rounded-xl border bg-muted/20 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{t("expiry")}</span>
              {grant.expires_at && days === 0 ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {t("edit.keepExpiry", { date: formatTime(grant.expires_at) })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {grant.expires_at ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDays(0)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                    days === 0
                      ? "border-primary bg-primary text-primary-foreground shadow-xs"
                      : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  )}
                >
                  {t("edit.keepExpiryShort")}
                </button>
              ) : null}
              {expiryDays.map((value) => {
                const selected = days === value
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    onClick={() => setDays(value)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums transition-all",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                    )}
                  >
                    {t("daysOption", { count: value })}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="block space-y-1.5 text-xs">
            <span className="font-medium text-foreground">{t("name")}</span>
            <Input
              maxLength={100}
              value={name}
              disabled={busy}
              className="h-9 bg-background text-sm"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameInvalid}
            />
          </label>
        </section>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {t("advanced")}
          </CollapsibleTrigger>
          {/* Padding keeps input focus rings visible inside the clipped animation. */}
          <CollapsibleContent className="-mx-1 px-1">
            <div className="mt-2.5 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs">
                <span className="font-medium text-foreground">{t("maxConnections")}</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={connections}
                  disabled={busy}
                  className="h-9 bg-background text-xs tabular-nums"
                  onChange={(event) => setConnections(Number(event.target.value))}
                  aria-invalid={!validConnections}
                />
              </label>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t bg-muted/20 px-6 py-3.5 sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              nameInvalid || issue ? "bg-amber-500" : "bg-sky-500",
            )}
          />
          <p className={cn("min-w-0 truncate", nameInvalid || issue ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {nameInvalid
              ? t(tokenName ? "authorization.nameTooLong" : "edit.nameRequired")
              : issue
                ? t(`authorization.issues.${issue}`)
                : t("edit.effect")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" disabled={busy}>
              {t("common:cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" size="sm" disabled={!canSave}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {busy ? t("edit.saving") : t("edit.save")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
