import { useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

const formatTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function TokenEditDialog({ token, onClose }: { token: AccessToken | null; onClose: () => void }) {
  return <Dialog open={!!token} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      {token && <TokenEdit key={token.id} token={token} onDone={onClose} />}
    </DialogContent>
  </Dialog>
}

function TokenEdit({ token, onDone }: { token: AccessToken; onDone: () => void }) {
  const { t } = useTranslation("automation")
  const detail = useQuery({ queryKey: queryKeys.automation.grant(token.grant_id), queryFn: () => grantsApi.detail(token.grant_id), staleTime: 0 })
  const sources = useQuery({ queryKey: queryKeys.automation.tokenSources, queryFn: loadTokenSources, staleTime: 0 })
  const header = <DialogHeader className="shrink-0 border-b p-6 pr-12">
    <DialogTitle className="truncate">{t("edit.title", { name: token.name })}</DialogTitle>
    <DialogDescription>{t("edit.description")}</DialogDescription>
  </DialogHeader>
  if (detail.isSuccess && sources.isSuccess) {
    return <TokenEditForm header={header} detail={detail.data} servers={sources.data.servers} scripts={sources.data.scripts} onDone={onDone} />
  }
  return <>
    {header}
    <div className="p-4">
      {detail.isError || sources.isError
        ? <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          {t("loadFailed")}
          <Button type="button" variant="outline" size="sm" onClick={() => void Promise.all([detail.refetch(), sources.refetch()])}>{t("retry")}</Button>
        </div>
        : <PageLoading className="min-h-0 py-10" />}
    </div>
  </>
}

function TokenEditForm({ header, detail, servers, scripts, onDone }: {
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

  return <form onSubmit={event => void submit(event)} className="flex min-h-0 flex-1 flex-col">
    {header}
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {!uniform && <p className="text-xs text-amber-700 dark:text-amber-400">{t("edit.nonUniform")}</p>}
      <TokenAuthorizationEditor value={draft} servers={servers} scripts={scripts} loading={false} disabled={busy} onChange={setDraft} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("expiry")}</span>
          <Select value={String(days)} disabled={busy} onValueChange={value => setDays(Number(value))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {grant.expires_at && <SelectItem value="0">{t("edit.keepExpiry", { date: formatTime(grant.expires_at) })}</SelectItem>}
              {expiryDays.map(value => <SelectItem key={value} value={String(value)}>{t("daysOption", { count: value })}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("name")}</span>
          <Input maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} aria-invalid={nameInvalid} />
        </label>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />{t("advanced")}
        </CollapsibleTrigger>
        {/* Padding keeps input focus rings visible inside the clipped animation. */}
        <CollapsibleContent className="-mx-1 px-1">
          <div className="grid gap-3 pb-1 pt-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">{t("maxConnections")}</span>
              <Input type="number" min={1} max={100} value={connections} disabled={busy} onChange={event => setConnections(Number(event.target.value))} aria-invalid={!validConnections} />
            </label>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
    <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t p-4 sm:justify-between">
      <p className="min-w-0 truncate text-xs text-muted-foreground">
        {nameInvalid ? t(tokenName ? "authorization.nameTooLong" : "edit.nameRequired")
          : issue ? t(`authorization.issues.${issue}`)
            : t("edit.effect")}
      </p>
      <Button type="submit" disabled={!canSave}>{busy ? t("edit.saving") : t("edit.save")}</Button>
    </DialogFooter>
  </form>
}
