import { useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/components/ui/sonner"
import { SftpManager } from "@/components/sftp/sftp-manager"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useSftpSession } from "@/hooks/useSftpSession"
import { createWorkspaceTransferAuthTicketProviderAdapter } from "@/lib/session/workspace-adapters"
import type { Server } from "@/lib/server-types"
import { useTerminalAuthFlowAdapters } from "@/components/terminal/use-terminal-auth-flow-adapters"
import { getServerAuthMethod, useSftpAuthRetry } from "@/components/sftp/use-sftp-auth-retry"

export interface TerminalSftpTabContentProps {
  sessionId: string
  server: Server
  label: string
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  onPathChange?: (path: string) => void
  refreshRequestVersion?: number
  initialPath?: string
  initialPathBackStack?: string[]
  initialPathForwardStack?: string[]
  onHistoryChange?: (history: {
    currentPath: string
    pathBackStack: string[]
    pathForwardStack: string[]
  }) => void
  onClose: () => void
  onRenameSession: (label: string) => void
}

export function TerminalSftpTabContent({
  sessionId,
  server,
  label,
  chrome = "full",
  surface = "normal",
  onPathChange,
  refreshRequestVersion = 0,
  initialPath = "/",
  initialPathBackStack,
  initialPathForwardStack,
  onHistoryChange,
  onClose,
  onRenameSession,
}: TerminalSftpTabContentProps) {
  const workspace = useOptionalSshWorkspace()
  const lastRefreshRequestVersionRef = useRef(0)
  const workspaceSftpApi = workspace?.adapters.apiClient?.sftp
  const workspaceI18n = workspace?.adapters.i18n
  const { t: tSftpFallback } = useTranslation("sftp")
  const { t: tTerminal } = useTranslation("terminal")
  const tSftp = useCallback((key: string, params?: Record<string, string | number>) => {
    const workspaceText = workspaceI18n?.t("sftp", key, params)
    if (workspaceText && workspaceText !== key) {
      return workspaceText
    }

    return tSftpFallback(key, params)
  }, [tSftpFallback, workspaceI18n])

  const notifier = useMemo(() => ({
    success: (message: string) => {
      if (workspace?.adapters.notifier?.success) {
        workspace.adapters.notifier.success(message)
        return
      }
      toast.success(message)
    },
    error: (message: string) => {
      if (workspace?.adapters.notifier?.error) {
        workspace.adapters.notifier.error(message)
        return
      }
      toast.error(message)
    },
    promise: <T,>(promise: Promise<T>, messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: unknown) => string)
    }) => {
      if (workspace?.adapters.notifier?.promise) {
        return workspace.adapters.notifier.promise(promise, messages)
      }

      return toast.promise(promise, messages)
    },
  }), [workspace?.adapters.notifier])

  const transferAuthTicketProvider = useMemo(
    () => createWorkspaceTransferAuthTicketProviderAdapter(workspace?.adapters.authTicketProvider),
    [workspace?.adapters.authTicketProvider],
  )

  const fileTransferOptions = useMemo(() => ({
    createTicket: transferAuthTicketProvider,
    uploadUsesProgressSocket: workspaceSftpApi?.uploadUsesProgressSocket ?? true,
    serverTransferUsesProgressSocket: workspaceSftpApi?.serverTransferUsesProgressSocket ?? true,
  }), [
    transferAuthTicketProvider,
    workspaceSftpApi?.serverTransferUsesProgressSocket,
    workspaceSftpApi?.uploadUsesProgressSocket,
  ])
  const effectiveAuthFlowAdapters = useTerminalAuthFlowAdapters({})
  const { credentialDialog, runWithCredentialRetry } = useSftpAuthRetry({
    tTerminal,
    adapters: effectiveAuthFlowAdapters,
  })
  const canRetrySftpCredentials = !workspaceSftpApi || !!workspaceSftpApi.authenticate

  const sftp = useSftpSession(String(server.id), initialPath, {
    api: workspaceSftpApi,
    notifier,
    t: tSftp,
    fileTransferOptions,
    serverName: server.name || `${server.username}@${server.host}:${server.port}`,
    authMethod: getServerAuthMethod(server),
    runWithCredentialRetry: canRetrySftpCredentials ? runWithCredentialRetry : undefined,
    initialPathBackStack,
    initialPathForwardStack,
    onHistoryChange,
  })
  const { currentPath, error, refresh } = sftp

  useEffect(() => {
    if (error) {
      notifier.error(error)
    }
  }, [error, notifier])

  useEffect(() => {
    onPathChange?.(currentPath)
  }, [currentPath, onPathChange])

  useEffect(() => {
    if (refreshRequestVersion > lastRefreshRequestVersionRef.current) {
      lastRefreshRequestVersionRef.current = refreshRequestVersion
      refresh()
      return
    }

    lastRefreshRequestVersionRef.current = refreshRequestVersion
  }, [refresh, refreshRequestVersion])

  return (
    <div className={surface === "transparent"
      ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      : "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"}
    >
      <SftpManager
        serverId={String(server.id)}
        serverName={server.name || `${server.username}@${server.host}:${server.port}`}
        host={server.host}
        username={server.username}
        isConnected
        currentPath={sftp.currentPath}
        files={sftp.files}
        sessionId={sessionId}
        sessionLabel={label}
        isFullscreen={false}
        chrome={chrome}
        surface={surface}
        viewModeStorageKey="easyssh:sftp:viewMode:merged"
        defaultViewMode="grid"
        isLoading={sftp.isLoading}
        onNavigate={sftp.navigate}
        onNavigateBack={sftp.goBack}
        canNavigateBack={sftp.canGoBack}
        onNavigateForward={sftp.goForward}
        canNavigateForward={sftp.canGoForward}
        onUpload={sftp.uploadFiles}
        onDownload={sftp.downloadFile}
        onDelete={sftp.deleteFile}
        onBatchDelete={sftp.batchDeleteFiles}
        onBatchDownload={sftp.batchDownloadFiles}
        onCreateFolder={sftp.createFolder}
        onCreateFile={sftp.createFile}
        onRename={sftp.renameFile}
        onDisconnect={onClose}
        onRefresh={sftp.refresh}
        onReadFile={sftp.readFile}
        onSaveFile={sftp.saveFile}
        onRenameSession={onRenameSession}
        transferTasks={sftp.transferTasks}
        onClearCompletedTransfers={sftp.clearCompletedTransfers}
        onCancelTransfer={sftp.cancelTransfer}
      />
      {canRetrySftpCredentials && credentialDialog}
    </div>
  )
}
