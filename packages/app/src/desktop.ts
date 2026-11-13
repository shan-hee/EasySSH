export { SshWorkspace, useOptionalSshWorkspace, useSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
export type { SshWorkspaceContextValue, SshWorkspaceRootProps, SshWorkspaceSnapshotUpdater } from "@/components/ssh-workspace/ssh-workspace"
export { ThemeProvider } from "@/components/theme-provider"
export { Toaster, toast } from "@/components/ui/sonner"
export { SidebarProvider } from "@/components/ui/sidebar"
export { ActivityLogPane } from "@/components/ssh-workspace/activity-log-pane"
export { Workbench } from "@/workbench/workbench"
export { WORKBENCH_VIEW, WorkspaceShell } from "@/workbench/workspace-shell"
export type { WorkspaceShellProps, WorkspaceView } from "@/workbench/workspace-shell"
export type { WorkbenchProps } from "@/workbench/workbench"
export { useWorkbenchSessions } from "@/workbench/use-workbench-sessions"
export type { UseWorkbenchSessionsOptions, WorkbenchSessions, WorkbenchSftpTab } from "@/workbench/use-workbench-sessions"
export { ServerConnectionConfigs } from "@/components/servers/server-connection-configs"
export { BackupRestoreTab, LogsClient, ScriptsPage } from "./desktop-components"
export { Activity, ArchiveRestore, ArrowLeft, Bell, Bot, Check, CheckCheck, ChevronDown, CircleCheck, Clipboard, Cloud, Download, ExternalLink, FileText, FolderOpen, Globe, Info, KeyRound, Languages, ListChecks, Loader2, Menu, Minus, Monitor, RefreshCw, RotateCw, Settings2, SlidersHorizontal, Square, Terminal, Trash2, TriangleAlert, Unplug, X, XCircle } from "lucide-react"
export type { BackupRestoreTabProps, LogsClientProps, ScriptsPageProps } from "./desktop-components"
export type { ScriptsPageAdapters } from "@/components/dashboard/scripts/scripts-page"
export type { InstanceBackupAdapter } from "@/components/settings/instance-backup-panel"
export type { ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
export { DEFAULT_SYSTEM_CONFIG, StaticSystemConfigProvider } from "@/contexts/system-config-context"
export {
  authMethodCredentialFields,
  authMethodFactors,
  normalizeSSHAuthMethod,
  primaryCredentialMethod,
  requiresPassword,
  requiresPrivateKey,
  supportsKeyboardInteractive,
} from "@/lib/ssh-auth-methods"
export type {
  SSHAuthFactor,
  SSHAuthMethod,
  SSHAuthMethodValue,
  SSHCredentialField,
} from "@/lib/ssh-auth-methods"
export { DEFAULT_SFTP_DOWNLOAD_EXCLUDE_PATTERNS, parseWorkspaceDownloadExcludePatterns } from "@/lib/session/workspace-settings"
export type { WorkspaceDownloadExcludePatternSource } from "@/lib/session/workspace-settings"
export type { DirectTransferOptions } from "@/lib/sftp-types"
export type { TransferJob } from "@/lib/transfer-job-types"
export type { SystemSnapshot } from "@/lib/system-info"
export { loadAISessionHistory, withEmptyHistory } from "@/lib/ai-agent/history"
export type { AIHistoryReader } from "@/lib/ai-agent/history"
export { readContentJSON } from "@/lib/content"
export type { ContentChunk, ContentReference } from "@/lib/content"
export type { AgentSessionEvent } from "@/hooks/use-agent-session"
export type { FileTransferSftpApi, TransferStartOptions } from "@/lib/session/transfer-manager-controller"
export { createWorkspaceAdapters, createWorkspaceI18nAdapter, createWorkspaceSettingsAdapter } from "@/lib/session/workspace-adapters"
export { createWorkspaceCapabilitiesFromRuntime } from "@/shell/runtime/runtime-workspace"
export type { RuntimeWorkspaceCapabilitiesOptions } from "@/shell/runtime/runtime-workspace"
export { WORKSPACE_CAPABILITY_PRESETS } from "@/shell/runtime/workspace-capability-presets"
export type { WorkspaceCapabilityPresetName } from "@/shell/runtime/workspace-capability-presets"
export { createTerminalWorkspaceSessionControllerAdapter, createTerminalWorkspaceSessionStoreAdapter } from "@/stores/terminal-store"
export type { AuthMethod, Server } from "@/lib/server-types"
export type { ServerListResponse } from "@/lib/server-types"
export type {
  CreateScriptRequest,
  ListScriptsParams,
  ListScriptsResponse,
  Script,
  UpdateScriptRequest,
} from "@/lib/script-types"
export type {
  BatchTask,
  CreateBatchTaskRequest,
  ListBatchTasksResponse,
} from "@/lib/batch-task-types"
export type {
  AuditLog,
  AuditLogListParams,
  AuditLogListResponse,
  AuditLogStatisticsResponse,
  AuditLogStatus,
} from "@/lib/log-types"
export type { TerminalWebSocketConstructor } from "@/lib/session/terminal-types"
export type { AppCapability, RuntimeInfo, RuntimePrincipal, RuntimeProfile } from "@/shell/runtime/types"
export type {
  SftpWorkspaceSession,
  SshWorkspaceAdapters,
  SshWorkspaceApiClient,
  SshWorkspaceAuthTicketProvider,
  SshWorkspaceCapabilities,
  SshWorkspaceI18n,
  SshWorkspaceLayout,
  SshWorkspaceNotifier,
  SshWorkspacePreferenceAdapter,
  SshWorkspaceProps,
  SshWorkspaceServerPicker,
  SshWorkspaceSessionController,
  SshWorkspaceSessionStoreAdapter,
  SshWorkspaceSettingsAdapter,
  SshWorkspaceActivityLogAdapter,
  SshWorkspaceSftpSessionController,
  SshWorkspaceThemeAdapter,
  SshWorkspaceTerminalSessionController,
  SshWorkspaceTransferHistoryAdapter,
  SshWorkspaceTransferManager,
  WorkspaceNotifierActionOptions,
  WorkspaceActivityLogItem,
  WorkspaceActivityLogListParams,
  WorkspaceActivityLogListResult,
  WorkspaceActivityLogRecordInput,
  WorkspaceActivityLogStatistics,
  WorkspaceActivityLogStatus,
  WorkspaceDockerApi,
  WorkspaceDockerContainer,
  WorkspaceDockerContainerLogsResponse,
  WorkspaceDockerContainerState,
  WorkspaceDockerContainerStats,
  WorkspaceDockerContainersResponse,
  WorkspaceDockerImage,
  WorkspaceDockerImagesResponse,
  WorkspaceDockerImageUpdateCheckResponse,
  WorkspaceDockerMount,
  WorkspaceDockerPort,
  WorkspaceDockerResourcesResponse,
  WorkspaceDockerSystemInfo,
  WorkspaceMonitorApi,
  WorkspaceMonitorCollectOptions,
  WorkspaceMonitorMetrics,
  WorkspaceMonitorWebSocketAuthTicketProvider,
  WorkspaceMonitorWebSocketAuthTicketRequest,
  WorkspaceMonitorWebSocketUrlRequest,
  WorkspaceMonitorWebSocketUrlResolver,
  WorkspaceSessionListUpdater,
  WorkspaceSessionSeed,
  WorkspaceSessionSnapshot,
  WorkspaceSftpCredentialRequest,
  WorkspaceSftpAuthPrompt,
  WorkspaceSftpAuthPromptItem,
  WorkspaceSftpAuthPromptResponder,
  WorkspaceSftpAuthResponsePayload,
  WorkspaceSftpHostKeyPrompt,
  WorkspaceSftpHostKeyResponder,
  WorkspaceTerminalCredentialSaveRequest,
  WorkspaceTerminalSession,
  WorkspaceTransferHistoryItem,
  WorkspaceTransferHistoryListParams,
  WorkspaceTransferHistoryListResult,
  WorkspaceTransferHistoryStatistics,
  WorkspaceTransferHistoryStatus,
  WorkspaceTransferHistoryType,
  WorkspaceTransferStatus,
  WorkspaceTransferTask,
} from "@/lib/session/workspace"
