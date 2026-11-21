import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CopyButton, MCPConnection } from "./mcp-connection"
import { TokenAuthorizationEditor } from "./token-authorization-editor"
import { automationApi } from "@/lib/api/automation"
import type { Grant } from "@/lib/api/grants"
import { scriptsApi } from "@/lib/api/scripts"
import { serversApi } from "@/lib/api/servers"
import { apiFetch } from "@/lib/api-client"
import { getErrorMessage } from "@/lib/error-utils"
import type { components } from "@/generated/openapi"
import { queryKeys } from "@/lib/query-keys"
import type { Script } from "@/lib/script-types"
import { loadAllServers } from "@/lib/server-utils"
import { newTokenAuthorization, tokenAuthorizationIssue, tokenResources } from "@/lib/token-authorization"
import { cn } from "@/lib/utils"

export const expiryDays = [7, 30, 90, 180, 365]

// Only the creation form needs the full catalog, so it loads when the dialog opens.
async function loadAllScripts() {
  const scripts: Script[] = []
  for (let page = 1; ; page++) {
    const result = await scriptsApi.list({ page, limit: 100 })
    scripts.push(...result.data)
    if (!result.data.length || scripts.length >= result.total) return scripts
  }
}

async function loadActiveGrants() {
  const grants: Grant[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await apiFetch<components["schemas"]["GrantList"]>(`/grants?limit=100&offset=${offset}`)
    grants.push(...page.items)
    if (!page.items.length || grants.length >= page.total) break
  }
  return grants.filter((grant) => !grant.revoked_at && (!grant.expires_at || Date.parse(grant.expires_at) > Date.now()))
}

export async function loadTokenSources() {
  const [servers, scripts, grants] = await Promise.all([
    loadAllServers((params) => serversApi.list(params)),
    loadAllScripts(),
    loadActiveGrants(),
  ])
  return { servers, scripts, grants }
}

export function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [secret, setSecret] = useState("")
  // Dialog blocks outside clicks and Escape so the new token is not dismissed before it is copied.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onExitComplete={() => setSecret("")}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {secret ? <TokenCreated token={secret} onDone={() => onOpenChange(false)} /> : <CreateTokenForm onCreated={setSecret} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateTokenForm({ onCreated }: { onCreated: (token: string) => void }) {
  const { t } = useTranslation("automation")
  const queryClient = useQueryClient()
  const sources = useQuery({ queryKey: queryKeys.automation.tokenSources, queryFn: loadTokenSources, staleTime: 0 })
  const [draft, setDraft] = useState(newTokenAuthorization)
  const [grantId, setGrantId] = useState("")
  const [name, setName] = useState("")
  const [days, setDays] = useState(30)
  const [connections, setConnections] = useState(4)
  const [busy, setBusy] = useState(false)
  const servers = sources.data?.servers ?? []
  const scripts = sources.data?.scripts ?? []
  const grants = sources.data?.grants ?? []
  const grant = grants.find((item) => item.id === grantId)
  const purpose = t(`authorization.presets.${draft.preset}.name`)
  const automaticName = grant?.name ?? t("authorization.automaticName", { purpose, count: draft.serverIds.length })
  const tokenName = name.trim() || automaticName
  const nameTooLong = new TextEncoder().encode(tokenName).length > 100
  const issue = !sources.isSuccess || grant ? null : tokenAuthorizationIssue(draft, servers, scripts)
  const validConnections = Number.isInteger(connections) && connections >= 1 && connections <= 100
  const canCreate = !busy && sources.isSuccess && !issue && !nameTooLong && (!!grant || validConnections)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    setBusy(true)
    try {
      const expires = Math.min(Date.now() + days * 86400000, grant?.expires_at ? Date.parse(grant.expires_at) : Infinity)
      const result = await automationApi.createToken({
        name: tokenName,
        expires_at: new Date(expires).toISOString(),
        ...(grant ? { grant_id: grant.id } : { authorization: { name: tokenName, resources: tokenResources(draft), max_connections: connections } }),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })
      onCreated(result.token)
    } catch (error) {
      toast.error(getErrorMessage(error, t("createFailed")))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-base">{t("createTitle")}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">{t("createDescription")}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {sources.isError && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3.5 py-2.5 text-xs text-destructive">
            <span>{t("loadFailed")}</span>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void sources.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}

        {grant ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/35 px-3.5 py-2.5 text-xs">
            <span className="min-w-0 truncate font-medium">{t("grantSource", { name: grant.name })}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs" disabled={busy} onClick={() => setGrantId("")}>
              {t("useNewPermissions")}
            </Button>
          </div>
        ) : (
          <TokenAuthorizationEditor
            value={draft}
            servers={servers}
            scripts={scripts}
            loading={sources.isPending}
            disabled={busy || !sources.isSuccess}
            onChange={setDraft}
          />
        )}

        {/* 有效期与名称：一键周期胶囊 + 名称输入框 */}
        <section className="space-y-3.5 rounded-xl border bg-muted/20 p-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">{t("expiry")}</span>
            <div className="flex flex-wrap gap-1.5">
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
            {grant?.expires_at && <p className="text-[11px] text-muted-foreground">{t("expiryHelp")}</p>}
          </div>

          <label className="block space-y-1.5 text-xs">
            <span className="font-medium text-foreground">{t("name")}</span>
            <Input
              maxLength={100}
              value={name}
              placeholder={automaticName}
              disabled={busy}
              className="h-9 bg-background text-sm"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameTooLong}
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
                <span className="font-medium text-foreground">{t("permissionSource")}</span>
                <Select value={grantId || "new"} disabled={busy || !grants.length} onValueChange={(value) => setGrantId(value === "new" ? "" : value)}>
                  <SelectTrigger className="h-9 w-full bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">{t("newPermissions")}</SelectItem>
                    {grants.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {!grant && (
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
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t bg-muted/20 px-6 py-3.5 sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              nameTooLong || issue ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          <p className={cn("min-w-0 truncate", nameTooLong || issue ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            {nameTooLong
              ? t("authorization.nameTooLong")
              : issue
                ? t(`authorization.issues.${issue}`)
                : grant
                  ? t("summaryGrant", { name: grant.name, days })
                  : t("authorization.summary", { count: draft.serverIds.length, purpose, days })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" disabled={busy}>
              {t("common:cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" size="sm" disabled={!canCreate}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {busy ? t("creating") : t("create")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}

function TokenCreated({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation("automation")
  return (
    <>
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-base">{t("createdTitle")}</DialogTitle>
            <DialogDescription className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>{t("createdDescription")}</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <TokenSecretView token={token} />
      </div>
      <DialogFooter className="shrink-0 border-t bg-muted/20 px-6 py-3.5">
        <Button type="button" size="sm" onClick={onDone}>
          {t("done")}
        </Button>
      </DialogFooter>
    </>
  )
}

export function TokenSecretView({ token }: { token: string }) {
  const { t } = useTranslation("automation")
  return (
    <>
      <section className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("secret.tokenValueLabel")}
        </span>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 py-2 pl-3.5 pr-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground sm:text-sm">
            {token}
          </code>
          <CopyButton value={token} label={t("copyToken")} />
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("createdNext")}
        </h3>
        <MCPConnection token={token} variant="hero" />
      </section>
    </>
  )
}
