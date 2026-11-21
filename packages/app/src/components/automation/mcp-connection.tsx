import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, TerminalSquare } from "lucide-react"
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
  // The default local scope binds the server to the directory where the command ran.
  "claude-code": (url: string, token: string) => `claude mcp add --scope user --transport http easyssh ${url} --header "Authorization: Bearer ${token}"`,
  cursor: (url: string, token: string) => json({ mcpServers: { easyssh: { url, headers: bearer(token) } } }),
  vscode: (url: string, token: string) => json({ servers: { easyssh: { type: "http", url, headers: bearer(token) } } }),
  generic: (url: string, token: string) => json({ url, transport: "streamable-http", headers: bearer(token) }),
}
type Client = keyof typeof clients

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const { t } = useTranslation("automation")
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 })
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      aria-label={label}
      title={label}
      onClick={() => { void copyToClipboard(value).catch(() => toast.error(t("copyFailed"))) }}
    >
      {isCopied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
    </Button>
  )
}

/** Without a token the snippet keeps a placeholder; right after creation it carries the real secret. */
export function MCPConnection({ token, variant = "default" }: { token?: string; variant?: "default" | "hero" }) {
  const { t } = useTranslation("automation")
  const [client, setClient] = useState<Client>("codex")
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 })
  const endpoint = new URL(getApiUrl("/mcp"), window.location.href).href
  const snippet = clients[client](endpoint, token ?? "<ACCESS_TOKEN>")

  if (variant === "hero") {
    return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-sm dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-zinc-900/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("connectionTitle")}>
            {(Object.keys(clients) as Client[]).map((id) => {
              const active = client === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setClient(id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-white/14 text-white"
                      : "text-zinc-400 hover:bg-white/6 hover:text-zinc-200",
                  )}
                >
                  {t(`clients.${id}`)}
                </button>
              )
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
            onClick={() => { void copyToClipboard(snippet).catch(() => toast.error(t("copyFailed"))) }}
          >
            {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            <span>{t("copyConfig")}</span>
          </Button>
        </div>

        <pre className="min-h-[124px] overflow-x-auto whitespace-pre-wrap break-all px-4 py-3.5 font-mono text-xs leading-6 text-zinc-200">
          {snippet}
        </pre>

        <div className="flex items-start gap-2 border-t border-white/10 bg-zinc-900/45 px-3.5 py-2 text-[11px] leading-5 text-zinc-400">
          <TerminalSquare className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
          <p>
            {t(`clientHints.${client}`)}
            {token ? "" : ` ${t("replaceToken")}`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      {!token && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pl-3 pr-1">
          <code className="min-w-0 flex-1 truncate text-sm">{endpoint}</code>
          <CopyButton value={endpoint} label={t("copyEndpoint")} />
        </div>
      )}
      <Tabs value={client} onValueChange={(value) => setClient(value as Client)}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {(Object.keys(clients) as Client[]).map((id) => (
            <TabsTrigger key={id} value={id} className="h-8">
              {t(`clients.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="relative">
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 pr-11 font-mono text-xs">{snippet}</pre>
        <CopyButton value={snippet} label={t("copyConfig")} className="absolute right-1.5 top-1.5" />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`clientHints.${client}`)}
        {token ? "" : ` ${t("replaceToken")}`}
      </p>
    </div>
  )
}
