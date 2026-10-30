import { remoteAccessContext } from "./remote-context"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Window } from "@wailsio/runtime"
import { ThemeProvider } from "@easyssh/app/components/theme-provider"
import { QueryProvider } from "@easyssh/app/providers/query-provider"
import { StaticSystemConfigProvider } from "@easyssh/app/contexts/system-config-context"
import { AccessWorkspace } from "@easyssh/app/components/sharing/access-workspace"
import { Button } from "@easyssh/app/components/ui/button"
import { Toaster } from "@easyssh/app/components/ui/sonner"
import {
  createWorkspaceAdapters,
  createWorkspaceI18nAdapter,
  createWorkspaceNotifierAdapter,
  createBrowserWorkspacePreferenceAdapter,
} from "@easyssh/app/lib/session/workspace-adapters"
import { installPlatformTransport } from "@easyssh/app/contracts/platform-transport"
import { toast } from "sonner"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import type { DesktopRemoteWorkspaceContext } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/models"
import { remoteTransport, setRemoteAvailable } from "./remote-transport"
import { RemoteWebSocket } from "./remote-socket"
import { closeRemoteStreams } from "./remote-stream"
import { remoteFileApi } from "./remote-file-api"
import { useRemoteTransfers } from "./remote-transfers"

installPlatformTransport(remoteTransport)
export default function RemoteApp() {
  const { t } = useTranslation("sharing")
  const [context, setContext] = useState<DesktopRemoteWorkspaceContext | null>(
    null,
  )
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try {
      const value = await Remote.Context()
      remoteAccessContext(value.access)
      setRemoteAvailable(true)
      setContext(value)
      setError("")
    } catch (e) {
      setRemoteAvailable(false)
      setError(String(e))
      setContext(null)
      await closeRemoteStreams()
      throw e
    }
  }, [])
  useEffect(
    () =>
      remoteTransport.subscribeCredentials(() => {
        if (remoteTransport.hasCredentials()) return
        setContext(null)
        setError(t("ended"))
        void closeRemoteStreams()
      }),
    [t],
  )
  useEffect(() => {
    void refresh().catch(() => undefined)
    return () => {
      void closeRemoteStreams()
    }
  }, [refresh])
  return (
    <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryProvider key={context?.access.actor.session_id ?? "unavailable"}>
        <StaticSystemConfigProvider workspaceReady={!!context}>
          {context ? (
            <RemoteWorkspace context={context} refresh={refresh} />
          ) : (
            <main className="space-y-4 p-8">
              <h1>{error ? t("unavailable") : t("opening")}</h1>
              {error && (
                <>
                  <p role="alert">{error}</p>
                  <Button onClick={() => void refresh().catch(() => undefined)}>
                    {t("refresh")}
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => void Window.Close()}>
                {t("close")}
              </Button>
            </main>
          )}
        </StaticSystemConfigProvider>
      </QueryProvider>
      <Toaster />
    </ThemeProvider>
  )
}
function RemoteWorkspace({
  context,
  refresh,
}: {
  context: DesktopRemoteWorkspaceContext
  refresh: () => Promise<void>
}) {
  const { t: common } = useTranslation("common"),
    { t: terminal } = useTranslation("terminal"),
    { t: sftp } = useTranslation("sftp"),
    { t } = useTranslation("sharing")
  const transfers = useRemoteTransfers()
  const adapters = useMemo(
    () =>
      createWorkspaceAdapters({
        apiClient: {
          sftp: remoteFileApi,
          terminal: {
            WebSocketCtor: RemoteWebSocket,
            createWebSocketUrl: (r) =>
              `remote://terminal?${new URLSearchParams({ serverId: r.serverId, cols: String(r.cols), rows: String(r.rows) })}`,
          },
          monitor: {
            WebSocketCtor: RemoteWebSocket,
            createAuthTicket: async () => "native",
            createWebSocketUrl: (r) =>
              `remote://monitor?${new URLSearchParams({ serverId: r.serverId, interval: String(r.interval) })}`,
          },
        },
        authTicketProvider: async () => "native",
        i18n: createWorkspaceI18nAdapter({ common, terminal, sftp }),
        notifier: createWorkspaceNotifierAdapter(toast),
        preferences: createBrowserWorkspacePreferenceAdapter({
          storage: sessionStorage,
          keyPrefix: `remote:${context.workspace.id}:`,
        }),
        transferManager: transfers.manager,
      }),
    [common, terminal, sftp, context.workspace.id, transfers.manager],
  )
  return (
    <AccessWorkspace
      desktop
      context={remoteAccessContext(context.access)}
      adapters={adapters}
      refresh={refresh}
      fileActions={(resource, path) =>
        resource.actions.includes("files.upload")
          ? transfers.upload(resource.id, path)
          : null
      }
      header={
        <>
          <span
            className="max-w-60 truncate text-xs text-muted-foreground"
            title={context.workspace.origin}
          >
            {context.workspace.origin}
          </span>
          {transfers.panel}
          <Button size="sm" variant="ghost" onClick={() => void Window.Close()}>
            {t("close")}
          </Button>
        </>
      }
    />
  )
}
