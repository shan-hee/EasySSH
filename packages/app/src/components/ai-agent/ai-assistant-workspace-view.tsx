import { AgentWorkspaceProvider, AgentWorkspacePanel, AgentWorkspaceToolbar } from "./agent-workspace-panel"
import { AISessionSidebar } from "./ai-session-sidebar"
import { AISidebarContent, useAISidebarHost } from "./ai-sidebar-host"
import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react"
import { ArrowLeft, Loader2, Settings2, SquarePen, X } from "lucide-react"

import { AgentThread } from "@/components/ai-agent/agent-thread"
import { AISessionHistoryPopover } from "@/components/ai-agent/ai-session-history-popover"
import { AIAssistantConfigPopover } from "@/components/ai-agent/ai-config-popover"
import {
  ComposerAttachmentList,
  MAX_COMPOSER_ATTACHMENTS,
  AgentSuggestions,
  buildAgentMessageContext,
  sortReferencedServers,
  toAgentImageAttachments,
  useComposerAttachments,
} from "@/components/ai-agent/composer"
import { PageHeader } from "@/components/page-header"
import { toast } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { AgentComposer, AgentComposerInput, AgentComposerSubmit, AgentComposerToolbar, AgentComposerTools, AgentComposerAttachButton, AgentComposerDictation } from "@/components/ai-agent/agent-composer"
import { AgentReasoningSelector } from "./agent-reasoning-selector"
import { AgentModelSelector } from "@/components/ai-agent/agent-model-selector"
import { modelSelectorTriggerVariants } from "@/components/assistant-ui/elements/model-selector"
import { EmptyState, EmptyStateGreeting } from "@/components/assistant-ui/elements/empty-state"
import { ServerReferencePicker } from "./server-reference-picker"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AgentSessionAdapter } from "@/hooks/use-agent-session"
import type { AIConfigAdapter } from "@/hooks/use-ai-config"
import { useSetAgentComposerDraft, useSessionDraftState } from "@/hooks/use-agent-composer-draft"
import { useAIAssistantController } from "@/hooks/use-ai-assistant-controller"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { getDefaultAISessionTitle, useAISessionHistory } from "@/hooks/use-ai-session-history"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { serversApi, type Server as ManagedServer } from "@/lib/api"
import { deleteAISession, listAISessions, renameAISession, type AgentSessionScope, type PermissionMode } from "@/lib/api/ai-agent"
import type { AIAssistantConfigAdapter } from "@/components/ai-agent/ai-config-popover"
import type { ServerListResponse } from "@/lib/api/servers"
import { mergeServerReferences, parseServerReferenceText } from "@/lib/ai-agent/server-mentions"
import { getServerDisplayName, loadAllServers } from "@/lib/server-utils"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

// Both columns use the workspace width, so the message scrollbar cannot make
// the transcript narrower than the composer on small screens.
const conversationColumnClass = "mx-auto w-[min(50rem,calc(100cqw-2rem))] @min-[30rem]:w-[min(50rem,calc(100cqw-6rem))] max-w-none"

export interface AIAssistantWorkspaceAdapters {
  aiConfig?: AIConfigAdapter
  aiSettings?: AIAssistantConfigAdapter
  aiSession?: AgentSessionAdapter
  servers?: {
    list: (params?: {
      page?: number
      limit?: number
      group?: string
      search?: string
    }) => Promise<ServerListResponse>
  }
  listAISessions?: typeof listAISessions
  renameAISession?: typeof renameAISession
  deleteAISession?: typeof deleteAISession
}

export interface AIAssistantWorkspaceViewProps {
  requestedSessionId?: string
  canConfigure?: boolean
  active?: boolean
  hidePageHeader?: boolean
  onReturnToTerminal?: () => void
  adapters?: AIAssistantWorkspaceAdapters
}

export function AIAssistantWorkspaceView({
  requestedSessionId,
  active = true,
  canConfigure = true,
  hidePageHeader = false,
  onReturnToTerminal,
  adapters,
}: AIAssistantWorkspaceViewProps) {
  const restoredRequest = useRef<string | null>(null)
  const { t } = useTranslation("aiAssistant")
  const sidebar = useAISidebarHost()
  const { ready } = useAuthReady()
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
  const controller = useAIAssistantController({
    aiConfigAdapter: adapters?.aiConfig,
    aiSessionAdapter: adapters?.aiSession,
  })
  const {
    config: { isLoading, isConfigured, models, refetch: refetchAIConfig },
    agentSession,
    model: selectedModel,
    setModel: setSelectedModel,
    permissionMode,
    setPermissionMode,
    isChatRequestActive,
    isAssistantActive,
    assistantLoadingState,
  } = controller
  const {
    session,
    sessionId,
    chatStatus,
    uiMessages,
    pendingApprovalCount,
    error,
    clearError,
    restoreLatestSession,
    restoreSession,
    startNewSession,
    startDraftSession,
    recoverComposerDraft,
    forgetComposerDraft,
    sendMessage,
    updateMessage: updateUserMessage,
    regenerateMessage,
    deleteMessage: deleteUserMessage,
    cancelSession,
    detachSession,
    discardSessionIfEmpty,
  } = agentSession

  const setDraft = useSetAgentComposerDraft(agentSession.runtime)
  const [serverReferences, setServerReferences, forgetServerReferences] = useSessionDraftState<AgentServerReference[]>(sessionId, [])
  const [availableServers, setAvailableServers] = useState<ManagedServer[]>([])
  const [serversLoading, setServersLoading] = useState(false)
  const handleServerReferenceSelected = useCallback((item: { id: string }) => {
    const server = availableServers.find((entry) => entry.id === item.id)
    if (!server) return
    setServerReferences((current) => mergeServerReferences(current, [{
      server_id: server.id,
      name: getServerDisplayName(server),
      host: server.host,
      port: server.port,
      username: server.username,
    }]))
  }, [availableServers, setServerReferences])

  const attachmentLimitNotice = useCallback(() => {
    toast.info(t("attachmentLimitHint", { count: MAX_COMPOSER_ATTACHMENTS }))
  }, [t])
  const attachmentRejectedNotice = useCallback((file: File, reason: "total-size" | "read") => {
    toast.error(reason === "total-size"
      ? t("attachmentTotalSizeHint")
      : t("attachmentReadFailed", { file: file.name }))
  }, [t])
  const {
    attachments,
    loading: attachmentsLoading,
    addFiles: addAttachmentFiles,
    remove: removeAttachment,
    forget: forgetAttachments,
    detach: detachAttachments,
    restore: restoreAttachments,
    release: releaseAttachments,
  } = useComposerAttachments({
    sessionId,
    onLimit: attachmentLimitNotice,
    onRejected: attachmentRejectedNotice,
  })
  const [configOpen, setConfigOpen] = useState(false)
  const [sessionCreating, setSessionCreating] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionCreatingRef = useRef(false)
  const history = useAISessionHistory({
    enabled: ready,
    visible: Boolean(sidebar) && active,
    listSessions: adapters?.listAISessions ?? listAISessions,
    renameSession: adapters?.renameAISession ?? renameAISession,
    deleteSession: adapters?.deleteAISession ?? deleteAISession,
    loadErrorMessage: t("sessionListLoadFailed"),
    renameErrorMessage: t("renameSessionFailed"),
    deleteErrorMessage: t("deleteSessionFailed"),
  })
  const {
    forget: forgetHistorySession,
    syncSession: syncHistorySession,
    setOpen: setHistoryOpen,
  } = history

  useEffect(() => {
    if (!active) {
      setConfigOpen(false)
      setHistoryOpen(false)
    }
  }, [active, setHistoryOpen])

  const loadServers = useCallback(async () => {
    if (!ready || !active) {
      return
    }

    setServersLoading(true)

    try {
      const servers = await loadAllServers(adapters?.servers?.list ?? serversApi.list)
      setAvailableServers(sortReferencedServers(servers))
    } catch {
      toast.error(t("toastLoadServersFailed"))
    } finally {
      setServersLoading(false)
    }
  }, [active, adapters?.servers, ready, t])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  useEffect(() => {
    if (!active || !requestedSessionId) restoredRequest.current = null
    if (!active || !ready || isLoading || agentSession.transport !== "idle") return
    if (requestedSessionId) {
      if (restoredRequest.current !== requestedSessionId) {
        restoredRequest.current = requestedSessionId
        void restoreSession(requestedSessionId)
      }
      return
    }
    if (!isConfigured || session) return
    void restoreLatestSession()
  }, [active, agentSession.transport, isConfigured, isLoading, ready, requestedSessionId, restoreLatestSession, restoreSession, session])

  const permissionOptions = useMemo(
    () =>
      [
        {
          value: "readonly" as const,
          label: t("permissionModeReadonly"),
          description: t("permissionModeReadonlyDesc"),
        },
        {
          value: "balanced" as const,
          label: t("permissionModeBalanced"),
          description: t("permissionModeBalancedDesc"),
        },
        {
          value: "privileged" as const,
          label: t("permissionModePrivileged"),
          description: t("permissionModePrivilegedDesc"),
        },
      ],
    [t]
  )

  const isConfigChecking = !ready || isLoading
  const showConfigAction = canConfigure && ready && !isLoading && !isConfigured
  const modelSelectDisabled = isConfigChecking || !isConfigured || models.length === 0
  const serverReferenceDisabled = !ready || isLoading || !isConfigured || sessionCreating || agentSession.transport === "connecting"
  const attachmentDisabled = attachmentsLoading || attachments.length >= MAX_COMPOSER_ATTACHMENTS || serverReferenceDisabled

  const hasTimeline = uiMessages.length > 0
  const createSessionDisabled = !ready || isLoading || !isConfigured || sessionCreating || attachmentsLoading

  const buildMessageContext = useCallback(
    () => buildAgentMessageContext({
      attachments,
      selectedServers: [],
      t,
    }),
    [attachments, t]
  )

  useEffect(() => {
    if (!session?.id) {
      return
    }
    syncHistorySession(session, t("newSession"))
  }, [session, syncHistorySession, t])

  const submit = async (messageText: string) => {
    const parsedDraft = parseServerReferenceText(messageText.trim(), serverReferences)
    const normalizedDraft = parsedDraft.content.trim()
    const submittedReferences = parsedDraft.references
    const submittedScope: AgentSessionScope = { kind: "global" }
    const contextText = buildMessageContext()
    const blockReasons: string[] = []

    if (!normalizedDraft && attachments.length === 0 && submittedReferences.length === 0) {
      blockReasons.push("empty_message")
    }
    if (!ready) {
      blockReasons.push("auth_not_ready")
    }
    if (isLoading) {
      blockReasons.push("config_loading")
    }
    if (!isConfigured) {
      blockReasons.push("ai_not_configured")
    }
    if (attachmentsLoading) {
      blockReasons.push("attachments_loading")
    }
    if (sessionCreatingRef.current || agentSession.transport === "connecting") {
      blockReasons.push("session_creating")
    }
    if (isChatRequestActive) {
      blockReasons.push(`chat_${chatStatus}`)
    }
    if (session && session.status !== "idle" && session.status !== "closed") {
      blockReasons.push(`session_${session.status}`)
    }

    if (blockReasons.length > 0) {
      if (normalizedDraft || attachments.length > 0 || submittedReferences.length > 0) {
        if (!ready || isLoading) {
          toast.info(t("checkingConfig"))
        } else if (!isConfigured) {
          toast.info(t("aiNotConfigured"))
        } else if (attachmentsLoading || sessionCreatingRef.current) {
          toast.info(t("loading"))
        } else if (isChatRequestActive || (session && session.status !== "idle" && session.status !== "closed")) {
          toast.info(
            pendingApprovalCount > 0
              ? t("pendingToolsHint", { count: pendingApprovalCount })
              : t(session?.status === "waiting_confirmation" ? "statusWaitingConfirmation" : "statusRunning")
          )
        }
      }
      return
    }

    const submittedAttachments = detachAttachments()
    setServerReferences([])
    setDraft("")
    let createdSessionId: string | null = null
    let submittedSessionId = sessionId
    const recoverDraft = () => {
      recoverComposerDraft(submittedSessionId, messageText)
      restoreAttachments(submittedAttachments, submittedSessionId)
      setServerReferences((current) => mergeServerReferences(submittedReferences, current), submittedSessionId)
    }

    sessionCreatingRef.current = true
    setSessionCreating(true)
    let preparing = true
    try {
      let imageAttachments
      try {
        imageAttachments = await toAgentImageAttachments(submittedAttachments)
      } catch {
        recoverDraft()
        toast.error(t("attachmentReadFailed"))
        return
      }

      if (!sessionId || session?.status === "closed") {
        const response = await startNewSession({
          model: selectedModel || undefined,
          permissionMode,
          scope: submittedScope,
        })
        if (!response) {
          recoverDraft()
          return
        }
        createdSessionId = response.session_id
        submittedSessionId = response.session_id
      }

      const sending = sendMessage(
        normalizedDraft || t("contextOnlyPrompt"),
        contextText,
        selectedModel || undefined,
        permissionMode,
        submittedScope,
        imageAttachments,
        submittedReferences,
      )
      // sendMessage installs the outgoing message synchronously. Navigation can
      // resume while the reply streams; recovery still targets this draft.
      sessionCreatingRef.current = false
      setSessionCreating(false)
      preparing = false
      const sendResult = await sending
      if (sendResult !== "failed") {
        releaseAttachments(submittedAttachments)
        return
      }
      if (createdSessionId && await discardSessionIfEmpty(createdSessionId)) {
        forgetHistorySession(createdSessionId)
        submittedSessionId = null
      }
      recoverDraft()
    } finally {
      if (preparing) {
        sessionCreatingRef.current = false
        setSessionCreating(false)
      }
    }
  }

  const handleUpdateUserMessage = useCallback(async (messageId: string, content: string, references: AgentServerReference[] = []) => {
    return updateUserMessage(messageId, content, {
      regenerate: true,
      serverReferences: references,
      contextText: buildMessageContext(),
      model: selectedModel || undefined,
      permissionMode,
      scope: { kind: "global" },
    })
  }, [buildMessageContext, permissionMode, selectedModel, updateUserMessage])

  const handleRegenerateUserMessage = useCallback(async (messageId: string) => {
    const messages = session?.messages ?? []
    const index = messages.findIndex((message) => message.id === messageId)
    if (index >= 0 && messages.slice(index + 1).some((message) => message.role === "user")) {
      const confirmed = await requestConfirm({ description: t("regenerateMessageConfirm"), variant: "destructive" })
      if (!confirmed) return false
    }
    return regenerateMessage(messageId, {
      contextText: buildMessageContext(),
      model: selectedModel || undefined,
      permissionMode,
      scope: { kind: "global" },
    })
  }, [buildMessageContext, permissionMode, selectedModel, regenerateMessage, requestConfirm, session?.messages, t])

  const handleDeleteUserMessage = useCallback(async (messageId: string) => {
    const stopped = session?.messages.some((message) => message.id === messageId && !!message.stopped_at)
    const confirmed = await requestConfirm({
      description: t(stopped ? "auiDiscardRunConfirm" : "deleteMessageConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return false
    }

    return deleteUserMessage(messageId)
  }, [deleteUserMessage, requestConfirm, session?.messages, t])

  const handleUseTemplate = (prompt: string) => {
    setDraft(prompt)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleCreateNewSession = async () => {
    if (createSessionDisabled || sessionCreatingRef.current) return
    sessionCreatingRef.current = true
    setSessionCreating(true)

    try {
      if (isAssistantActive) {
        const confirmed = await requestConfirm({
          description: t("replaceRunningSessionConfirm"),
          variant: "destructive",
        })
        if (!confirmed) return
      }
      await startDraftSession({ kind: "global" })
      history.setOpen(false)
      history.setSearch("")
      sidebar?.closeMobile()
      requestAnimationFrame(() => inputRef.current?.focus())
    } finally {
      sessionCreatingRef.current = false
      setSessionCreating(false)
    }
  }

  const handleRestoreSession = async (targetSessionId: string) => {
    if (!targetSessionId || sessionCreatingRef.current || attachmentsLoading || history.renamingId) {
      return
    }

    if (targetSessionId === sessionId) {
      history.setOpen(false)
      sidebar?.closeMobile()
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }

    const restored = await restoreSession(targetSessionId)
    if (restored) {
      history.setOpen(false)
      sidebar?.closeMobile()
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }

  const handleDeleteSession = async (targetSessionId: string) => {
    if (!targetSessionId || history.actionLoadingId) {
      return
    }

    const confirmed = await requestConfirm({
      description: t("deleteSessionConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    const removed = await history.remove(targetSessionId)
    if (removed) {
      forgetComposerDraft(targetSessionId)
      forgetAttachments(targetSessionId)
      forgetServerReferences(targetSessionId)
      if (targetSessionId === sessionId) {
        detachSession(targetSessionId)
      }
      toast.success("会话已删除")
    } else {
      toast.error(t("deleteSessionFailed"))
    }
  }

  const handleAttachmentSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (sessionCreatingRef.current) return
    await addAttachmentFiles(files)
  }, [addAttachmentFiles])

  const handleAttachmentPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (sessionCreatingRef.current) return
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    void addAttachmentFiles(files)
  }, [addAttachmentFiles])

  const historyItem = history.items.find((item) => item.id === sessionId)
  const sessionTitle = historyItem?.custom_title ? historyItem.title
    : session?.title || (session ? getDefaultAISessionTitle(session, t("newSession")) : t("newSession"))

  const actionButtonClass = "size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-accent"

  const historyPopover = (
    <AISessionHistoryPopover
      activeSessionId={sessionId}
      align="start"
      history={history}
      onDelete={handleDeleteSession}
      onRestore={handleRestoreSession}
      t={t}
      triggerClassName={actionButtonClass}
      className="border-border bg-popover"
    />
  )

  const configuration = canConfigure && (
    <AIAssistantConfigPopover
        side={sidebar ? "right" : "bottom"}
        open={configOpen}
        onOpenChange={setConfigOpen}
        adapter={adapters?.aiSettings}
        onSaved={() => {
          void refetchAIConfig()
        }}
        trigger={
          <TooltipIconButton
            type="button"
            className={actionButtonClass}
            tooltip={t("configureAI")}
          >
            <Settings2 className="size-4" />
          </TooltipIconButton>
        }
      />
  )

  const sessionToolbar = (
    <>
      <TooltipIconButton
        type="button"
        className={actionButtonClass}
        disabled={createSessionDisabled}
        onClick={() => void handleCreateNewSession()}
        tooltip={t("newSession")}
      >
        {sessionCreating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <SquarePen className="size-4" />
        )}
      </TooltipIconButton>
      {historyPopover}
      {configuration}
    </>
  )
  return (
    <AssistantRuntimeProvider runtime={agentSession.runtime}>
    <AgentWorkspaceProvider sessionId={sessionId} tasks={agentSession.tasks} messages={session?.messages} scope={session?.scope} active={active} loadFile={adapters?.aiSession?.getTaskFile} saveFile={adapters?.aiSession?.saveTaskFile} approve={async (id, approved) => { await agentSession.respondToToolApproval({ id, approved }) }} stop={cancelSession}>
    {sidebar && active && <AISidebarContent>
      <AssistantRuntimeProvider runtime={agentSession.runtime}>
      <AISessionSidebar
        history={history} activeSessionId={sessionId}
        onCreate={handleCreateNewSession} onRestore={handleRestoreSession} onDelete={handleDeleteSession}
        creating={sessionCreating} createDisabled={createSessionDisabled}
        configuration={configuration} t={t}
        listSessions={adapters?.listAISessions}
      />
      </AssistantRuntimeProvider>
    </AISidebarContent>}
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      {confirmDialog}
      {active && !hidePageHeader && <PageHeader title={sessionTitle} />}

      <div className="flex shrink-0 justify-end px-3"><AgentWorkspaceToolbar /></div>

      {(!sidebar || onReturnToTerminal) && <div className="shrink-0 px-4 pb-1 md:px-4">
        <div className="flex h-9 items-center justify-between gap-2">
          {onReturnToTerminal ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-9 gap-1 bg-transparent px-2 text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
              aria-label="返回终端"
              title="返回终端"
              onClick={onReturnToTerminal}
            >
              <ArrowLeft className="size-4" />
              <span>返回终端</span>
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center justify-end gap-1">
            {!sidebar && sessionToolbar}
          </div>
        </div>
      </div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={cn("@container flex min-h-0 flex-1 min-w-0 flex-col pb-4 md:pb-6", hasTimeline ? "overflow-hidden" : "overflow-y-auto")}>
          <div className={cn("flex flex-1 flex-col", hasTimeline ? "min-h-0" : "min-h-fit py-8")}>
            <div className={hasTimeline ? "min-h-0 flex-1 overflow-hidden" : "hidden"}>
              {hasTimeline && (
                <AgentThread
                  key={sessionId ?? "new"}
                  tText={t}
                  scope={session?.scope}
                  referenceServers={availableServers}
                  referenceServersLoading={serversLoading}
                  onUpdateUserMessage={handleUpdateUserMessage}
                  onRegenerateUserMessage={handleRegenerateUserMessage}
                  onContinueStoppedRun={(id) => agentSession.continueRun(id, t("auiContinuePrompt"), { model: selectedModel || undefined, permissionMode })}
                  onDeleteUserMessage={handleDeleteUserMessage}
                  assistantLoadingState={assistantLoadingState}
                  className="h-full w-full"
                  contentClassName={cn(conversationColumnClass, "px-0 py-6 [&_[data-slot=aui_assistant-message-content]]:px-0")}
                  viewportClassName="[scrollbar-gutter:stable_both-edges]"
                />
              )}
            </div>

            <div className={cn("w-full shrink-0", hasTimeline ? "pt-4" : "my-auto")}>
              {!canConfigure && ready && !isLoading && !isConfigured && <p role="status" className={cn(conversationColumnClass, "mb-3 text-sm text-muted-foreground")}>{t("sharedAINotConfigured")}</p>}
              {agentSession.reconnecting && (
                <div role="status" className={cn(conversationColumnClass, "mb-3 flex items-center gap-2 text-sm text-muted-foreground")}>
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                  {t("auiReconnecting")}
                </div>
              )}
              {error && (
                <ErrorState detail={error} className={cn(conversationColumnClass, "mb-3")} action={
                  <TooltipIconButton type="button" className="-my-1 size-7 shrink-0" onClick={clearError} tooltip={t("cancel")}>
                    <X className="size-3.5" />
                  </TooltipIconButton>
                } />
              )}

              <EmptyState className={cn(conversationColumnClass, "block")}>
                {!hasTimeline && <EmptyStateGreeting className="mb-8 text-3xl font-semibold">{t("auiWelcomeGreeting")}</EmptyStateGreeting>}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,text/*,.json,.yaml,.yml,.xml,.csv,.md,.log,.sh,.py,.js,.ts,.tsx,.go,.rs,.java,.sql"
                  className="hidden"
                  onChange={(event) => void handleAttachmentSelection(event)}
                />

                <AgentComposer
                  onSubmit={(text) => submit(text)}
                >
                  <ComposerAttachmentList
                    attachments={attachments}
                    onRemoveAttachment={removeAttachment}
                    t={t}
                  />
                  <AgentComposerInput
                    ref={inputRef}
                    disabled={sessionCreating || agentSession.transport === "connecting"}
                    directivePluginProps={{ onDirectiveSelect: handleServerReferenceSelected }}
                    onPaste={handleAttachmentPaste}
                    placeholder={hasTimeline ? t("composerPlaceholder") : t("inputPlaceholderWithMention")}
                  />
                  <ServerReferencePicker servers={availableServers} references={serverReferences} onChange={setServerReferences} loading={serversLoading} disabled={serverReferenceDisabled} />

                  <AgentComposerToolbar className="flex-wrap gap-2">
                    <AgentComposerTools className="min-w-0 flex-wrap">
                      <AgentComposerAttachButton onClick={() => fileInputRef.current?.click()} disabled={attachmentDisabled} aria-busy={attachmentsLoading} title={t("attachFile")} />

                      <Select
                        value={permissionMode}
                        onValueChange={(value) => setPermissionMode(value as PermissionMode)}
                        disabled={isConfigChecking}
                      >
                        <SelectTrigger
                          size="sm"
                          className={cn(modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }), "rounded-full text-muted-foreground")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          sideOffset={6}
                          className="terminal-ai-glass-popover w-auto rounded-xl data-[side=bottom]:translate-y-0 data-[side=left]:translate-x-0 data-[side=right]:translate-x-0 data-[side=top]:translate-y-0"
                        >
                          {permissionOptions.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="rounded-lg py-2 pl-3 pr-9 font-medium [&>span:first-child]:right-3"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {showConfigAction && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 px-2.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground sm:text-sm"
                          onClick={() => { sidebar?.reveal(); setConfigOpen(true) }}
                        >
                          {t("configureAI")}
                        </Button>
                      )}
                    </AgentComposerTools>

                    <div className="ml-auto flex min-w-0 items-center gap-1">
                      <AgentReasoningSelector value={agentSession.reasoningEffort} onValueChange={agentSession.setReasoningEffort} disabled={modelSelectDisabled} />
                      <AgentModelSelector models={models} value={selectedModel} onValueChange={setSelectedModel} disabled={modelSelectDisabled} />
                      <AgentComposerDictation disabled={isConfigChecking || !isConfigured || isAssistantActive} />
                      <AgentComposerSubmit running={isAssistantActive} hasContent={attachments.length > 0 || serverReferences.length > 0} disabled={sessionCreating || attachmentsLoading || agentSession.transport === "connecting"} onCancel={cancelSession} />
                    </div>
                  </AgentComposerToolbar>
                </AgentComposer>
                {!hasTimeline && <AgentSuggestions onUseTemplate={handleUseTemplate} />}

                <div className="mt-2 text-center text-xs text-muted-foreground">
                  {t("safetyNotice")}
                </div>
              </EmptyState>
            </div>
          </div>
        </div>
        <AgentWorkspacePanel />
      </div>
    </div>
    </AgentWorkspaceProvider>
    </AssistantRuntimeProvider>
  )
}
