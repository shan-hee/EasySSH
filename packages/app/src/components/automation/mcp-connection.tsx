import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { getApiUrl } from "@/lib/api-client"
import { cn } from "@/lib/utils"

const json = (value: unknown) => JSON.stringify(value, null, 2)
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

// Each entry renders the format the client reads directly, so users only
// replace the token placeholder instead of rewriting field names.
const clients = {
  codex: (url: string, token: string) => `[mcp_servers.easyssh]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`,
  "claude-code": (url: string, token: string) => `claude mcp add --transport http easyssh ${url} --header "Authorization: Bearer ${token}"`,
  cursor: (url: string, token: string) => json({ mcpServers: { easyssh: { url, headers: bearer(token) } } }),
  vscode: (url: string, token: string) => json({ servers: { easyssh: { type: "http", url, headers: bearer(token) } } }),
  generic: (url: string, token: string) => json({ url, transport: "streamable-http", headers: bearer(token) }),
}
type Client = keyof typeof clients

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const { t } = useTranslation("automation")
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 })
  return <Button type="button" variant="ghost" size="icon-sm" className={cn("shrink-0", className)} aria-label={label} title={label}
    onClick={() => { void copyToClipboard(value).catch(() => toast.error(t("copyFailed"))) }}>
    {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
  </Button>
}

/** Without a token the snippet keeps a placeholder; right after creation it carries the real secret. */
export function MCPConnection({ token }: { token?: string }) {
  const { t } = useTranslation("automation")
  const [client, setClient] = useState<Client>("codex")
  const endpoint = new URL(getApiUrl("/mcp"), window.location.href).href
  const snippet = clients[client](endpoint, token ?? "<ACCESS_TOKEN>")
  return <div className="min-w-0 space-y-3">
    {!token && <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate text-sm">{endpoint}</code>
      <CopyButton value={endpoint} label={t("copyEndpoint")} />
    </div>}
    <Tabs value={client} onValueChange={value => setClient(value as Client)}>
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        {(Object.keys(clients) as Client[]).map(id => <TabsTrigger key={id} value={id} className="h-8">{t(`clients.${id}`)}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    <div className="relative">
      <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 pr-11 font-mono text-xs">{snippet}</pre>
      <CopyButton value={snippet} label={t("copyConfig")} className="absolute right-1.5 top-1.5" />
    </div>
    <p className="text-xs text-muted-foreground">{t(`clientHints.${client}`)}{token ? "" : ` ${t("replaceToken")}`}</p>
  </div>
}
