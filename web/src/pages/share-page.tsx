import { apiFetch } from "@easyssh/app/lib/api-client"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { accessSession, accessTransport } from "../platform/access-session"
import { ThemeProvider } from "@easyssh/app/components/theme-provider"
import { QueryProvider } from "@easyssh/app/providers/query-provider"
import { StaticSystemConfigProvider } from "@easyssh/app/contexts/system-config-context"
import { Toaster } from "@easyssh/app/components/ui/sonner"
import { Button } from "@easyssh/app/components/ui/button"
import { PageLoading } from "@easyssh/app/components/page-loading"
import { AccessWorkspace } from "@easyssh/app/components/sharing/access-workspace"
import {
  createBrowserWorkspacePreferenceAdapter,
  createWorkspaceAdapters,
  createWorkspaceI18nAdapter,
  createWorkspaceNotifierAdapter,
} from "@easyssh/app/lib/session/workspace-adapters"
import { workspaceAccessTicketProvider } from "@easyssh/app/lib/access-ticket"
import { sftpApi } from "@easyssh/app/lib/api/sftp"
import { toast } from "sonner"
import type { AccessContext } from "@easyssh/app/lib/api/grants"

export default function SharePage() {
  const { publicId = "" } = useParams()
  const { t } = useTranslation("sharing")
  const { t: common } = useTranslation("common")
  const { t: terminal } = useTranslation("terminal")
  const { t: sftp } = useTranslation("sftp")
  const [context, setContext] = useState<AccessContext | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    setContext(null)
    setError("")
    void accessSession
      .start(publicId)
      .then((r) => {
        if (active) setContext(r.context)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    const off = accessTransport.subscribeCredentials(() => {
      if (!accessTransport.hasCredentials()) {
        setContext(null)
        setError(t("ended"))
      }
    })
    return () => {
      active = false
      off()
    }
  }, [publicId, t])
  const adapters = useMemo(
    () =>
      createWorkspaceAdapters({
        apiClient: { sftp: sftpApi },
        authTicketProvider: workspaceAccessTicketProvider,
        i18n: createWorkspaceI18nAdapter({ common, terminal, sftp }),
        notifier: createWorkspaceNotifierAdapter(toast),
        preferences: createBrowserWorkspacePreferenceAdapter({
          storage: sessionStorage,
          keyPrefix: `access:${context?.actor.session_id}:`,
        }),
      }),
    [common, terminal, sftp, context?.actor.session_id],
  )
  return (
    <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryProvider key={context?.actor.session_id ?? publicId}>
        <StaticSystemConfigProvider workspaceReady={!!context}>
          {error ? (
            <main className="mx-auto max-w-xl space-y-4 p-8">
              <h1 className="text-lg font-medium">{t("unavailable")}</h1>
              <p role="alert">{error}</p>
              <p className="text-sm text-muted-foreground">{t("reopen")}</p>
              <Button onClick={() => window.location.reload()}>
                {t("refresh")}
              </Button>
            </main>
          ) : context ? (
            <AccessWorkspace
              key={context.actor.session_id}
              onLeave={async () => {
                await apiFetch(`/access/sessions/${context.actor.session_id}`, {
                  method: "DELETE",
                })
                accessSession.end()
              }}
              context={context}
              adapters={adapters}
              refresh={async () => {
                const c = await accessSession.refresh()
                setContext(c)
              }}
            />
          ) : (
            <PageLoading label={t("opening")} />
          )}
        </StaticSystemConfigProvider>
      </QueryProvider>
      <Toaster />
    </ThemeProvider>
  )
}
