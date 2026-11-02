import { useState, lazy, Suspense, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { PageLoading } from "@/components/page-loading"
import { toast } from "@/components/ui/sonner"
import type { ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import { SftpServerPickerDialog } from "@/components/sftp/sftp-server-picker-dialog"
import {
  TerminalComponent,
  type TerminalComponentProps,
  type TerminalExtraSessionRenderOptions,
} from "@/components/terminal/terminal-component"
import type { TerminalConnectionPhase, TerminalSession } from "@/components/terminal/types"
import { PreloadedTerminalSftpTabContent as TerminalSftpTabContent } from "@/lib/terminal-preload"
import type { WorkbenchSessions } from "./use-workbench-sessions"

const RDPLauncher = lazy(() => import("@/components/rdp/rdp-launcher").then(m => ({ default: m.RDPLauncher })))
const VNCLauncher = lazy(() => import("@/components/vnc/vnc-launcher").then(m => ({ default: m.VNCLauncher })))

type TerminalPresentationProps = Pick<
  TerminalComponentProps,
  "aiAssistantAdapters" | "hidePageHeader" | "unframed" | "settingsDialogOpen" | "onSettingsDialogOpenChange" | "tabBarEndContent" | "serverToolbarActions"
>

export interface WorkbenchProps extends TerminalPresentationProps {
  enableVnc?: boolean
  enableRdp?: boolean
  workbench: WorkbenchSessions
  serverApi: ServerConnectionConfigsApi
  /** 服务器列表可以读取时为 true，例如 Web 认证就绪后。 */
  serversReady: boolean
  /** 终端连接通道就绪前暂缓自动连接，例如桌面运行时加载期间。 */
  terminalTransportReady?: boolean
}

function deferConnections(sessions: TerminalSession[]) {
  return sessions.map((session) => (
    session.type === "terminal" && session.shouldConnect
      ? { ...session, shouldConnect: false, connectionPhase: "idle" as TerminalConnectionPhase }
      : session
  ))
}

/**
 * Web 与桌面共用的终端和文件工作台：连接标签、文件标签、服务器选择与会话内容。
 * 会话编排由 `useWorkbenchSessions` 提供，平台差异由适配器与上层容器决定。
 */
export function Workbench({
  workbench,
  serverApi,
  serversReady,
  terminalTransportReady = true,
  enableVnc = false,
  enableRdp = false,
  ...presentation
}: WorkbenchProps): ReactNode {
  const { t } = useTranslation("terminal")
  const [rdpOpen, setRdpOpen] = useState(false)
  const [vncOpen, setVncOpen] = useState(false)
  const {
    sessions,
    sftpTabs,
    sftpTabSessions,
    canUseSftp,
  } = workbench

  const renderSftpTabContent = (session: TerminalSession, options?: TerminalExtraSessionRenderOptions) => {
    const tab = sftpTabs.find((item) => item.id === session.id)
    if (!tab) return null

    return (
      <Suspense fallback={<PageLoading className="h-full min-h-0" />}>
        <TerminalSftpTabContent
          sessionId={tab.id}
          isActive={options?.isActive ?? true}
          externalTransfers={options?.externalTransfers}
          server={tab.server}
          label={tab.label}
          chrome={options?.chrome}
          surface={options?.surface}
          onConnectionStateChange={(connected, loading) => {
            workbench.updateSftpTab(tab.id, { connectionPhase: connected ? "ready" : loading ? "ssh_connecting" : "failed" })
          }}
          onPathChange={(path) => {
            options?.onPathChange?.(path)
            workbench.updateSftpTab(tab.id, { initialPath: path })
          }}
          refreshRequestVersion={options?.refreshRequestVersion}
          initialPath={options?.initialPath ?? tab.initialPath}
          initialPathBackStack={options?.initialPathBackStack}
          initialPathForwardStack={options?.initialPathForwardStack}
          onHistoryChange={options?.onHistoryChange}
          onClose={() => workbench.closeSftpTab(tab.id)}
          onRenameSession={(label) => workbench.renameSftpTab(tab.id, label)}
        />
      </Suspense>
    )
  }

  return (
    <>
      {enableRdp && rdpOpen && <Suspense fallback={null}><RDPLauncher open={rdpOpen} onOpenChange={setRdpOpen} serverApi={serverApi} onConnect={workbench.createRdpTab} /></Suspense>}
      {enableVnc && vncOpen && <Suspense fallback={null}><VNCLauncher open={vncOpen} onOpenChange={setVncOpen} serverApi={serverApi} onConnect={workbench.createVncTab} /></Suspense>}
      <SftpServerPickerDialog
        open={canUseSftp && workbench.sftpPickerOpen}
        ready={serversReady}
        serverApi={serverApi}
        onOpenChange={workbench.setSftpPickerOpen}
        onSelect={workbench.createSftpTab}
        currentServerId={sessions.find((session) => session.id === workbench.activeSessionId)?.serverId}
        openedServerIds={sftpTabs.map((tab) => String(tab.server.id))}
      />
      <TerminalComponent
        {...presentation}
        sessions={terminalTransportReady ? sessions : deferConnections(sessions)}
        extraSessions={sftpTabSessions}
        onNewRdpSession={enableRdp && serversReady ? () => setRdpOpen(true) : undefined}
        onNewVncSession={enableVnc && serversReady ? () => setVncOpen(true) : undefined}
        onNewSftpSession={canUseSftp ? workbench.openSftpPicker : undefined}
        renderExtraSessionContent={renderSftpTabContent}
        onOpenSftpSession={async (session, path) => {
          if (!session.serverId) return
          try {
            workbench.createSftpTab(await serverApi.getById(session.serverId), path ?? "~")
          } catch {
            toast.error(t("sftpPickerFailed"))
          }
        }}
        onCloseExtraSession={workbench.closeSftpTab}
        onReorderExtraSessions={workbench.reorderSftpTabs}
        externalActiveExtraSessionId={workbench.activeSftpTabId}
        onActiveExtraSessionChange={workbench.setActiveSftpTabId}
        onCloseSession={workbench.closeSession}
        onCloseSessions={workbench.closeSessions}
        onSendCommand={workbench.recordCommand}
        onDuplicateSession={workbench.duplicateSession}
        onCloseOthers={workbench.closeOthers}
        onCloseAll={workbench.closeAll}
        onTogglePin={workbench.togglePin}
        onReorderSessions={workbench.reorderSessions}
        onStartConnection={workbench.startConnection}
        onAuthCancelled={workbench.cancelAuthentication}
        externalActiveSessionId={workbench.activeSessionId}
        onActiveSessionChange={workbench.setActiveSessionId}
        onConnectionPhaseChange={workbench.changeConnectionPhase}
        serverApi={serverApi}
        serverConfigsReady={serversReady}
        inactiveReminderLimit={workbench.inactiveReminderLimit}
      />
    </>
  )
}
