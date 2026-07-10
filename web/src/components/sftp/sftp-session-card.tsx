
import React from "react"
import { Server } from "lucide-react"
import { SftpWorkspacePanel } from "@/components/sftp/sftp-workspace-panel"
import { cn } from "@/lib/utils"
import type { TransferJob } from "@/lib/api/transfer-jobs"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"
import type { BatchDeleteResult } from "@/lib/session/sftp-operations"
import type { SftpWorkspaceSession } from "@/lib/session/workspace"

export interface SftpSessionCardProps {
  session: SftpWorkspaceSession
  isFullscreen: boolean
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  connectingText: string
  transferTasks?: WorkspaceTransferTask[]
  backgroundTransferJobs?: TransferJob[]
  onClearCompletedTransfers?: () => void
  onCancelTransfer?: (taskId: string) => void
  onCreateBackgroundUploadSession?: (sessionId: string, files: FileList) => void | Promise<void>
  onCreateBackgroundDownloadSession?: (sessionId: string, fileName: string) => void | Promise<void>
  onCancelBackgroundTransfer?: (jobId: string) => void
  onDeleteBackgroundTransfer?: (jobId: string) => void
  onDownloadBackgroundArtifact?: (jobId: string) => void
  onNavigateSession: (sessionId: string, path: string) => void
  onNavigateBackSession: (sessionId: string) => void | Promise<void>
  onNavigateForwardSession: (sessionId: string) => void | Promise<void>
  onUploadSession: (sessionId: string, files: FileList, onProgress?: (fileName: string, loaded: number, total: number) => void) => void
  onDownloadSession: (sessionId: string, fileName: string) => void
  onDeleteSession: (sessionId: string, fileName: string, isDirectory: boolean) => void
  onBatchDeleteSession: (sessionId: string, fileNames: string[], hasDirectory: boolean) => Promise<BatchDeleteResult>
  onBatchDownloadSession: (sessionId: string, fileNames: string[], excludePatterns?: string[]) => Promise<void>
  onCreateFolderSession: (sessionId: string, name: string) => void
  onCreateFileSession: (sessionId: string, name: string) => void
  onRenameSessionFile: (sessionId: string, oldName: string, newName: string) => void
  onDisconnectSession: (sessionId: string) => void
  onRefreshSession: (sessionId: string) => void
  onReadFileSession: (sessionId: string, fileName: string) => Promise<string>
  onSaveFileSession: (sessionId: string, fileName: string, content: string) => Promise<void>
  onRenameSessionLabel: (sessionId: string, newLabel: string) => void
  onToggleFullscreen: (sessionId: string) => void
}

export const SftpSessionCard = React.memo(function SftpSessionCard({
  session,
  isFullscreen,
  chrome = "full",
  surface = "normal",
  connectingText,
  transferTasks,
  backgroundTransferJobs,
  onClearCompletedTransfers,
  onCancelTransfer,
  onCreateBackgroundUploadSession,
  onCreateBackgroundDownloadSession,
  onCancelBackgroundTransfer,
  onDeleteBackgroundTransfer,
  onDownloadBackgroundArtifact,
  onNavigateSession,
  onNavigateBackSession,
  onNavigateForwardSession,
  onUploadSession,
  onDownloadSession,
  onDeleteSession,
  onBatchDeleteSession,
  onBatchDownloadSession,
  onCreateFolderSession,
  onCreateFileSession,
  onRenameSessionFile,
  onDisconnectSession,
  onRefreshSession,
  onReadFileSession,
  onSaveFileSession,
  onRenameSessionLabel,
  onToggleFullscreen,
}: SftpSessionCardProps) {
  const onNavigate = React.useCallback((path: string) => onNavigateSession(session.id, path), [onNavigateSession, session.id])
  const onNavigateBack = React.useCallback(() => onNavigateBackSession(session.id), [onNavigateBackSession, session.id])
  const onNavigateForward = React.useCallback(() => onNavigateForwardSession(session.id), [onNavigateForwardSession, session.id])
  const onUpload = React.useCallback(
    (files: FileList, onProgress?: (fileName: string, loaded: number, total: number) => void) =>
      onUploadSession(session.id, files, onProgress),
    [onUploadSession, session.id],
  )
  const onDownload = React.useCallback((fileName: string) => onDownloadSession(session.id, fileName), [onDownloadSession, session.id])
  const onCreateBackgroundUpload = React.useCallback(
    (files: FileList) => onCreateBackgroundUploadSession?.(session.id, files),
    [onCreateBackgroundUploadSession, session.id],
  )
  const onCreateBackgroundDownload = React.useCallback(
    (fileName: string) => onCreateBackgroundDownloadSession?.(session.id, fileName),
    [onCreateBackgroundDownloadSession, session.id],
  )
  const onDelete = React.useCallback((fileName: string, isDirectory: boolean) => onDeleteSession(session.id, fileName, isDirectory), [onDeleteSession, session.id])
  const onBatchDelete = React.useCallback((fileNames: string[], hasDirectory: boolean) => onBatchDeleteSession(session.id, fileNames, hasDirectory), [onBatchDeleteSession, session.id])
  const onBatchDownload = React.useCallback(
    (fileNames: string[], excludePatterns?: string[]) =>
      onBatchDownloadSession(session.id, fileNames, excludePatterns),
    [onBatchDownloadSession, session.id],
  )
  const onCreateFolder = React.useCallback((name: string) => onCreateFolderSession(session.id, name), [onCreateFolderSession, session.id])
  const onCreateFile = React.useCallback((name: string) => onCreateFileSession(session.id, name), [onCreateFileSession, session.id])
  const onRename = React.useCallback((oldName: string, newName: string) => onRenameSessionFile(session.id, oldName, newName), [onRenameSessionFile, session.id])
  const onDisconnect = React.useCallback(() => onDisconnectSession(session.id), [onDisconnectSession, session.id])
  const onRefresh = React.useCallback(() => onRefreshSession(session.id), [onRefreshSession, session.id])
  const onReadFile = React.useCallback((fileName: string) => onReadFileSession(session.id, fileName), [onReadFileSession, session.id])
  const onSaveFile = React.useCallback(
    (fileName: string, content: string) => onSaveFileSession(session.id, fileName, content),
    [onSaveFileSession, session.id],
  )
  const onRenameLabel = React.useCallback((newLabel: string) => onRenameSessionLabel(session.id, newLabel), [onRenameSessionLabel, session.id])
  const onToggleFullscreenBound = React.useCallback(() => onToggleFullscreen(session.id), [onToggleFullscreen, session.id])

  if (!session.isConnected) {
    if (chrome === "toolbar") {
      return null
    }

    return (
      <div
        className={cn(
          "h-full flex flex-col rounded-none border-0 overflow-hidden",
          (surface !== "transparent" || isFullscreen) && "bg-background"
        )}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3 py-8">
            <div className="inline-flex items-center justify-center w-12 h-12 border border-border bg-muted/60">
              <Server className="h-6 w-6 text-primary animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{connectingText}</p>
              <p className="text-xs text-muted-foreground font-mono">{session.serverName || session.host}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SftpWorkspacePanel
      serverId={session.serverId}
      serverName={session.serverName}
      host={session.host}
      username={session.username}
      isConnected={session.isConnected}
      currentPath={session.currentPath}
      files={session.files}
      sessionId={session.id}
      sessionLabel={session.label}
      sessionColor={session.color}
      isFullscreen={isFullscreen}
      chrome={chrome}
      surface={surface}
      viewModeStorageKey="easyssh:sftp:viewMode:sftp-workspace"
      defaultViewMode="list"
      isLoading={session.isLoading}
      onNavigate={onNavigate}
      onNavigateBack={onNavigateBack}
      canNavigateBack={(session.pathBackStack?.length ?? 0) > 0}
      onNavigateForward={onNavigateForward}
      canNavigateForward={(session.pathForwardStack?.length ?? 0) > 0}
      onUpload={onUpload}
      onDownload={onDownload}
      onDelete={onDelete}
      onBatchDelete={onBatchDelete}
      onBatchDownload={onBatchDownload}
      onCreateFolder={onCreateFolder}
      onCreateFile={onCreateFile}
      onRename={onRename}
      onDisconnect={onDisconnect}
      onRefresh={onRefresh}
      onReadFile={onReadFile}
      onSaveFile={onSaveFile}
      onRenameSession={onRenameLabel}
      onToggleFullscreen={onToggleFullscreenBound}
      transferTasks={transferTasks}
      backgroundTransferJobs={backgroundTransferJobs}
      onClearCompletedTransfers={onClearCompletedTransfers}
      onCancelTransfer={onCancelTransfer}
      onCreateBackgroundUpload={onCreateBackgroundUploadSession ? onCreateBackgroundUpload : undefined}
      onCreateBackgroundDownload={onCreateBackgroundDownloadSession ? onCreateBackgroundDownload : undefined}
      onCancelBackgroundTransfer={onCancelBackgroundTransfer}
      onDeleteBackgroundTransfer={onDeleteBackgroundTransfer}
      onDownloadBackgroundArtifact={onDownloadBackgroundArtifact}
    />
  )
})
