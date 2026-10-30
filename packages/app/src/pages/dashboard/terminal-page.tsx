import { useEffect, useMemo, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "@/components/ui/sonner"
import { SshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { defaultServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import { serversApi, sftpApi } from "@/lib/api"
import { workspaceAccessTicketProvider } from "@/lib/access-ticket"
import { createTerminalWorkspaceSessionControllerAdapter, createTerminalWorkspaceSessionStoreAdapter } from "@/stores/terminal-store"
import { createBrowserWorkspacePreferenceAdapter, createWorkspaceAdapters, createWorkspaceI18nAdapter, createWorkspaceNotifierAdapter, createWorkspaceSettingsAdapter } from "@/lib/session/workspace-adapters"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useTranslation } from "react-i18next"
import { useSystemConfig } from "@/contexts/system-config-context"
import { WORKSPACE_CAPABILITY_PRESETS, createWorkspaceCapabilitiesFromRuntime, useRuntime } from "@/shell/runtime"
import { primaryCredentialMethod } from "@/lib/ssh-auth-methods"
import { ViewportWorkspaceTransition } from "@/components/viewport-workspace-transition"
import { Workbench } from "@/workbench/workbench"
import { useWorkbenchSessions } from "@/workbench/use-workbench-sessions"

function TerminalPageContent() {
  const { ready } = useAuthReady()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { config: systemConfig } = useSystemConfig()
  const { runtime } = useRuntime()
  const { t: tCommon } = useTranslation("common")
  const { t } = useTranslation("terminal")
  const { t: tServers } = useTranslation("servers")
  const { t: tSftp } = useTranslation("sftp")
  const consumedServerIdRef = useRef<string | null>(null)
  const consumedSftpOpenRef = useRef(false)
  const serverIdFromSearch = searchParams.get("serverId")?.trim() ?? ""
  const shouldOpenSftpFromSearch = searchParams.get("sftpPicker") === "1"

  const workspaceCapabilities = useMemo(() => (
    createWorkspaceCapabilitiesFromRuntime(runtime, WORKSPACE_CAPABILITY_PRESETS.webTerminal)
  ), [runtime])
  const workbench = useWorkbenchSessions({
    canUseSftp: workspaceCapabilities.sftp !== false,
    inactiveReminderLimit: systemConfig?.tab_session?.inactive_minutes ?? 60,
  })
  const { openSftpPicker, startConnection } = workbench

  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspacePreferences = useMemo(() => createBrowserWorkspacePreferenceAdapter(), [])
  const workspaceAdapters = useMemo(() => createWorkspaceAdapters({
    apiClient: {
      sftp: sftpApi,
      terminal: {
          saveVerifiedCredential: ({ serverId, authMethod, secret, password, privateKey, privateKeyPassphrase }) => {
            const payload = {
              auth_method: authMethod,
              verified_connection_credential: true,
              private_key_passphrase: privateKeyPassphrase,
              ...(password !== undefined ? { password } : {}),
              ...(privateKey !== undefined ? { private_key: privateKey } : {}),
              ...(password === undefined && privateKey === undefined
                ? primaryCredentialMethod(authMethod) === "key"
                  ? { private_key: secret }
                  : { password: secret }
                : {}),
            }

          return serversApi.update(serverId, payload)
        },
      },
    },
    i18n: createWorkspaceI18nAdapter({
      common: tCommon,
      terminal: t,
      sftp: tSftp,
    }),
    notifier: createWorkspaceNotifierAdapter(toast),
    settings: createWorkspaceSettingsAdapter({
      sftp: {
        downloadExcludePatterns: systemConfig?.download_exclude_patterns,
      },
    }),
    preferences: workspacePreferences,
    authTicketProvider: workspaceAccessTicketProvider,
    sessionStore: workspaceSessionStore,
    sessionController: workspaceSessionController,
  }), [tCommon, t, tSftp, systemConfig?.download_exclude_patterns, workspacePreferences, workspaceSessionController, workspaceSessionStore])

  useEffect(() => {
    if (!shouldOpenSftpFromSearch) {
      consumedSftpOpenRef.current = false
      return
    }
    if (!ready || consumedSftpOpenRef.current) return

    consumedSftpOpenRef.current = true
    openSftpPicker()
    setTimeout(() => {
      const url = new URL(window.location.href)
      url.searchParams.delete("sftpPicker")
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
    }, 0)
  }, [navigate, openSftpPicker, ready, shouldOpenSftpFromSearch])

  const startConnectionRef = useRef(startConnection)
  startConnectionRef.current = startConnection

  useEffect(() => {
    if (!serverIdFromSearch) {
      consumedServerIdRef.current = null
    }
  }, [serverIdFromSearch])

  useEffect(() => {
    if (!ready || !serverIdFromSearch) {
      return
    }
    if (consumedServerIdRef.current === serverIdFromSearch) {
      return
    }

    consumedServerIdRef.current = serverIdFromSearch
    let cancelled = false

    const cleanSearchParam = () => {
      if (typeof window === "undefined") {
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete("serverId")
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
    }

    const connectFromSearch = async () => {
      try {
        const server = await serversApi.getById(serverIdFromSearch)
        if (cancelled) {
          return
        }

        startConnectionRef.current(server)
        cleanSearchParam()
      } catch (error) {
        if (cancelled) return
        consumedServerIdRef.current = null
        console.error("Failed to connect server from quick access:", error)
        toast.error(tServers("toastLoadFailed"))
        cleanSearchParam()
      }
    }

    void connectFromSearch()

    return () => {
      cancelled = true
      if (consumedServerIdRef.current === serverIdFromSearch) {
        consumedServerIdRef.current = null
      }
    }
  }, [ready, navigate, serverIdFromSearch, tServers])

  return (
    <SshWorkspace
      adapters={workspaceAdapters}
      capabilities={workspaceCapabilities}
      layout="web"
    >
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        <Workbench
          workbench={workbench}
          serverApi={defaultServerConnectionConfigsApi}
          serversReady={ready}
        />
      </div>
    </SshWorkspace>
  )
}

/** Web 终端页：页头显示当前会话与活动，工作台在页面内留出边距。 */
export default function TerminalPage() {
  return (
    <ViewportWorkspaceTransition>
      <TerminalPageContent />
    </ViewportWorkspaceTransition>
  )
}
