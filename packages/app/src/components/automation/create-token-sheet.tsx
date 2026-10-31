import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ChevronRight, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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

const expiryDays = [7, 30, 90, 180, 365]

// Only the creation form needs the full catalog, so it loads when the sheet opens.
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
  return grants.filter(grant => !grant.revoked_at && (!grant.expires_at || Date.parse(grant.expires_at) > Date.now()))
}

async function loadTokenSources() {
  const [servers, scripts, grants] = await Promise.all([loadAllServers(params => serversApi.list(params)), loadAllScripts(), loadActiveGrants()])
  return { servers, scripts, grants }
}

export function CreateTokenSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [secret, setSecret] = useState("")
  const change = (next: boolean) => {
    if (!next) setSecret("")
    onOpenChange(next)
  }
  // The secret is shown once; outside clicks must not discard it by accident.
  const keepSecret = (event: Event) => { if (secret) event.preventDefault() }
  return <Sheet open={open} onOpenChange={change}>
    <SheetContent className="w-full gap-0 sm:max-w-xl" onInteractOutside={keepSecret} onEscapeKeyDown={keepSecret}>
      {secret ? <TokenCreated token={secret} onDone={() => change(false)} /> : <CreateTokenForm onCreated={setSecret} />}
    </SheetContent>
  </Sheet>
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
  const grant = grants.find(item => item.id === grantId)
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

  return <form onSubmit={event => void submit(event)} className="flex min-h-0 flex-1 flex-col">
    <SheetHeader className="border-b pr-10">
      <SheetTitle>{t("createTitle")}</SheetTitle>
      <SheetDescription>{t("createDescription")}</SheetDescription>
    </SheetHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {sources.isError && <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
        {t("loadFailed")}
        <Button type="button" variant="outline" size="sm" onClick={() => void sources.refetch()}>{t("retry")}</Button>
      </div>}
      {grant
        ? <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <span className="min-w-0 truncate">{t("grantSource", { name: grant.name })}</span>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setGrantId("")}>{t("useNewPermissions")}</Button>
        </div>
        : <TokenAuthorizationEditor value={draft} servers={servers} scripts={scripts} loading={sources.isPending} disabled={busy || !sources.isSuccess} onChange={setDraft} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("expiry")}</span>
          <Select value={String(days)} disabled={busy} onValueChange={value => setDays(Number(value))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{expiryDays.map(value => <SelectItem key={value} value={String(value)}>{t("daysOption", { count: value })}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("name")}</span>
          <Input maxLength={100} value={name} placeholder={automaticName} disabled={busy} onChange={event => setName(event.target.value)} aria-invalid={nameTooLong} />
        </label>
      </div>
      {grant?.expires_at && <p className="text-xs text-muted-foreground">{t("expiryHelp")}</p>}

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />{t("advanced")}
        </CollapsibleTrigger>
        {/* Padding keeps input focus rings visible inside the clipped animation. */}
        <CollapsibleContent className="-mx-1 px-1">
          <div className="grid gap-3 pb-1 pt-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">{t("permissionSource")}</span>
              <Select value={grantId || "new"} disabled={busy || !grants.length} onValueChange={value => setGrantId(value === "new" ? "" : value)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">{t("newPermissions")}</SelectItem>
                  {grants.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {!grant && <label className="space-y-1.5 text-sm">
              <span className="font-medium">{t("maxConnections")}</span>
              <Input type="number" min={1} max={100} value={connections} disabled={busy} onChange={event => setConnections(Number(event.target.value))} aria-invalid={!validConnections} />
            </label>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
    <SheetFooter className="flex-row items-center justify-between gap-3 border-t">
      <p className="min-w-0 truncate text-xs text-muted-foreground">
        {nameTooLong ? t("authorization.nameTooLong")
          : issue ? t(`authorization.issues.${issue}`)
            : grant ? t("summaryGrant", { name: grant.name, days })
              : t("authorization.summary", { count: draft.serverIds.length, purpose, days })}
      </p>
      <Button type="submit" disabled={!canCreate}>{busy ? t("creating") : t("create")}</Button>
    </SheetFooter>
  </form>
}

function TokenCreated({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation("automation")
  return <>
    <SheetHeader className="border-b pr-10">
      <SheetTitle>{t("createdTitle")}</SheetTitle>
      <SheetDescription className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4 shrink-0" />{t("createdDescription")}</SheetDescription>
    </SheetHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 break-all text-sm">{token}</code>
        <CopyButton value={token} label={t("copyToken")} />
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("createdNext")}</h3>
        <MCPConnection token={token} />
      </section>
    </div>
    <SheetFooter className="border-t">
      <Button type="button" onClick={onDone}>{t("done")}</Button>
    </SheetFooter>
  </>
}
