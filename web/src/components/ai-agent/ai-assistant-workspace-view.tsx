
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type SyntheticEvent } from "react"
import { ArrowLeft, Loader2, Plus, RefreshCw, Send, Server as ServerIcon, Settings2, Square, SquarePen, X } from "lucide-react"

import { AgentAIElementsTimeline } from "@/components/ai-agent/agent-ai-elements-timeline"
import { AgentApprovalQueue } from "@/components/ai-agent/agent-approval-queue"
import { AIAssistantCommandBar } from "@/components/ai-agent/ai-assistant-command-bar"
import { AIModelControl, AIPermissionControl } from "@/components/ai-agent/ai-model-permission-controls"
import { AISessionHistoryPopover } from "@/components/ai-agent/ai-session-history-popover"
import { AIAssistantConfigPopover } from "@/components/ai-agent/ai-config-popover"
import {
  ComposerReferenceChips,
  MAX_COMPOSER_ATTACHMENTS,
  PromptTemplateGrid,
  buildAgentMessageContext,
  sortReferencedServers,
  toAgentImageAttachments,
  useComposerAttachments,
} from "@/components/ai-agent/composer"
import { PageHeader } from "@/components/page-header"
import { toast } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import {
  Conversation,
  ConversationContent,
  ConversationInitialScroll,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { AgentNoticeCard } from "@/components/ai-agent/agent-notice"
import type { AgentSessionAdapter } from "@/hooks/use-agent-session"
import type { AIConfigAdapter } from "@/hooks/use-ai-config"
import { useAIAssistantController } from "@/hooks/use-ai-assistant-controller"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useAISessionHistory } from "@/hooks/use-ai-session-history"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { serversApi, type Server as ManagedServer } from "@/lib/api"
import { deleteAISession, listAISessions, renameAISession, type AgentSessionScope, type CreateSessionResponse } from "@/lib/api/ai-agent"
import type { AIAssistantConfigAdapter } from "@/components/ai-agent/ai-config-popover"
import type { ServerListResponse } from "@/lib/api/servers"
import { getServerDisplayName } from "@/lib/server-utils"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import { useSynchronousSelectedItemScroll } from "@/hooks/use-synchronous-selected-item-scroll"

const SERVER_MENTION_LIMIT = 8

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
  hidePageHeader?: boolean
  customConfigOnly?: boolean
  onReturnToTerminal?: () => void
  adapters?: AIAssistantWorkspaceAdapters
}

function createWorkspaceScopeFromServer(server: ManagedServer): AgentSessionScope {
  return {
    kind: "terminal",
    server_id: server.id,
    server_name: getServerDisplayName(server),
    host: server.host,
    port: server.port,
    username: server.username,
  }
}

function workspaceScopeFromServers(selectedServers: ManagedServer[]) {
  if (selectedServers.length !== 1) {
    return undefined
  }

  return createWorkspaceScopeFromServer(selectedServers[0])
}

function workspaceScopeFromMentionedServers(mentionedServers: ManagedServer[]): AgentSessionScope {
  return workspaceScopeFromServers(mentionedServers) ?? { kind: "global" }
}

function getServerMentionText(server: ManagedServer) {
  return `@${getServerDisplayName(server)}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isServerMentioned(value: string, server: ManagedServer) {
  const mentionText = getServerMentionText(server)
  return new RegExp(`${escapeRegExp(mentionText)}(?=$|[\\s,，。.!?;；:：、)\\]）】])`, "u").test(value)
}

function getMentionedServers(value: string, servers: ManagedServer[]) {
  return servers.filter((server) => isServerMentioned(value, server))
}

function getServerMentionSearchText(server: ManagedServer) {
  return [
    getServerDisplayName(server),
    server.name,
    server.host,
    server.username,
    server.group,
    `${server.username}@${server.host}:${server.port}`,
    ...(server.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function getActiveServerMention(value: string, caretPosition: number | null | undefined) {
  if (caretPosition === null || caretPosition === undefined) {
    return null
  }

  const beforeCaret = value.slice(0, caretPosition)
  const triggerStart = beforeCaret.lastIndexOf("@")
  if (triggerStart < 0) {
    return null
  }

  const query = beforeCaret.slice(triggerStart + 1)
  if (/\s/.test(query)) {
    return null
  }

  return {
    end: caretPosition,
    query,
    start: triggerStart,
  }
}

function assertCustomConfigAdapters(customConfigOnly: boolean, adapters?: AIAssistantWorkspaceAdapters) {
  if (!customConfigOnly) {
    return
  }

  if (
    !adapters?.aiConfig ||
    !adapters.aiSettings ||
    !adapters.aiSession ||
    !adapters.servers ||
    !adapters.listAISessions ||
    !adapters.renameAISession ||
    !adapters.deleteAISession
  ) {
    throw new Error("Custom AI workspace requires local AI, server, and session adapters")
  }
}

export function AIAssistantWorkspaceView({
  hidePageHeader = false,
  customConfigOnly = false,
  onReturnToTerminal,
  adapters,
}: AIAssistantWorkspaceViewProps) {
  assertCustomConfigAdapters(customConfigOnly, adapters)

  const { t } = useTranslation("aiAssistant")
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
    pendingConfirmationTasks,
    error,
    clearError,
    restoreLatestSession,
    restoreSession,
    startNewSession,
    sendMessage,
    updateMessage: updateUserMessage,
    deleteMessage: deleteUserMessage,
    confirmTask,
    cancelSession,
    detachSession,
  } = agentSession

  const [draft, setDraft] = useState("")
  const [availableServers, setAvailableServers] = useState<ManagedServer[]>([])
  const [serversLoading, setServersLoading] = useState(false)
  const [serverMention, setServerMention] = useState<{
    end: number
    query: string
    start: number
  } | null>(null)
  const [serverMentionIndex, setServerMentionIndex] = useState(0)
  const serverMentionListRef = useRef<HTMLDivElement>(null)
  const serverMentionItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
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
    clear: clearAttachments,
    detach: detachAttachments,
    restore: restoreAttachments,
    release: releaseAttachments,
  } = useComposerAttachments({
    onLimit: attachmentLimitNotice,
    onRejected: attachmentRejectedNotice,
  })
  const [configOpen, setConfigOpen] = useState(false)
  const [sessionCreating, setSessionCreating] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionCreatingRef = useRef(false)
  const history = useAISessionHistory({
    enabled: ready && !isLoading && isConfigured,
    listSessions: adapters?.listAISessions ?? listAISessions,
    renameSession: adapters?.renameAISession ?? renameAISession,
    deleteSession: adapters?.deleteAISession ?? deleteAISession,
    loadErrorMessage: t("sessionListLoadFailed"),
    renameErrorMessage: t("renameSessionFailed"),
    deleteErrorMessage: t("deleteSessionFailed"),
  })
  const {
    prepend: prependHistorySession,
    syncSession: syncHistorySession,
  } = history

  const loadServers = useCallback(async () => {
    if (!ready) {
      return
    }

    setServersLoading(true)

    try {
      const response = await (adapters?.servers?.list ?? serversApi.list)({ limit: 1000 })
      setAvailableServers(sortReferencedServers(response.data))
    } catch {
      toast.error(t("toastLoadServersFailed"))
    } finally {
      setServersLoading(false)
    }
  }, [adapters?.servers, ready, t])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  useEffect(() => {
    if (!ready || isLoading || !isConfigured || session || agentSession.transport !== "idle") {
      return
    }

    void restoreLatestSession()
  }, [agentSession.transport, isConfigured, isLoading, ready, restoreLatestSession, session])

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
  const showConfigAction = ready && !isLoading && !isConfigured
  const modelSelectDisabled = isConfigChecking || !isConfigured || models.length === 0
  const serverReferenceDisabled = !ready || isLoading || !isConfigured
  const attachmentDisabled = attachmentsLoading || attachments.length >= MAX_COMPOSER_ATTACHMENTS || !ready || isLoading || !isConfigured

  const hasTimeline = uiMessages.length > 0
  const isCurrentSessionBlank = Boolean(
    session &&
    session.status !== "closed" &&
    uiMessages.length === 0 &&
    agentSession.tasks.length === 0
  )
  const createSessionDisabled = !ready || isLoading || !isConfigured || sessionCreating
  const canAttemptSubmit = Boolean(draft.trim()) || attachments.length > 0

  const buildMessageContext = useCallback(
    (messageText: string) => buildAgentMessageContext({
      attachments,
      selectedServers: getMentionedServers(messageText, availableServers),
      t,
    }),
    [attachments, availableServers, t]
  )

  const prependSessionListItem = useCallback((response: CreateSessionResponse) => {
    prependHistorySession(response, t("newSession"))
  }, [prependHistorySession, t])

  useEffect(() => {
    if (!session?.id) {
      return
    }
    syncHistorySession(session, t("newSession"))
  }, [session, syncHistorySession, t])

  const submit = async (messageText = draft) => {
    const normalizedDraft = messageText.trim()
    const submittedServers = getMentionedServers(normalizedDraft, availableServers)
    const submittedScope = workspaceScopeFromMentionedServers(submittedServers)
    const contextText = buildMessageContext(normalizedDraft)
    const blockReasons: string[] = []

    if (!normalizedDraft && attachments.length === 0) {
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
    if (sessionCreatingRef.current) {
      blockReasons.push("session_creating")
    }
    if (isChatRequestActive) {
      blockReasons.push(`chat_${chatStatus}`)
    }
    if (session && session.status !== "idle" && session.status !== "closed") {
      blockReasons.push(`session_${session.status}`)
    }

    if (blockReasons.length > 0) {
      if (normalizedDraft || attachments.length > 0) {
        if (!ready || isLoading) {
          toast.info(t("checkingConfig"))
        } else if (!isConfigured) {
          toast.info(t("aiNotConfigured"))
        } else if (attachmentsLoading || sessionCreatingRef.current) {
          toast.info(t("loading"))
        } else if (isChatRequestActive || (session && session.status !== "idle" && session.status !== "closed")) {
          toast.info(
            pendingConfirmationTasks.length > 0
              ? t("pendingToolsHint", { count: pendingConfirmationTasks.length })
              : t(session?.status === "waiting_confirmation" ? "statusWaitingConfirmation" : "statusRunning")
          )
        }
      }
      return
    }

    const submittedAttachments = detachAttachments()
    setDraft("")

    if (!sessionId || session?.status === "closed") {
      sessionCreatingRef.current = true
      setSessionCreating(true)

      const response: CreateSessionResponse | null = await (async () => {
        try {
          return await startNewSession({
            model: selectedModel || undefined,
            permissionMode,
            scope: submittedScope,
          })
        } finally {
          sessionCreatingRef.current = false
          setSessionCreating(false)
        }
      })()

      if (!response) {
        setDraft((current) => current || messageText)
        restoreAttachments(submittedAttachments)
        return
      }
      prependSessionListItem(response)
    }

    let imageAttachments
    try {
      imageAttachments = await toAgentImageAttachments(submittedAttachments)
    } catch {
      setDraft((current) => current || messageText)
      restoreAttachments(submittedAttachments)
      toast.error(t("attachmentReadFailed"))
      return
    }

    const sent = await sendMessage(
      normalizedDraft || t("contextOnlyPrompt"),
      contextText,
      selectedModel || undefined,
      permissionMode,
      submittedScope,
      imageAttachments
    )
    if (!sent) {
      setDraft((current) => current || messageText)
      restoreAttachments(submittedAttachments)
    } else {
      releaseAttachments(submittedAttachments)
    }
  }

  const handleUpdateUserMessage = useCallback(async (messageId: string, content: string) => {
    const mentionedServers = getMentionedServers(content, availableServers)
    return updateUserMessage(messageId, content, {
      regenerate: true,
      contextText: buildMessageContext(content),
      model: selectedModel || undefined,
      permissionMode,
      scope: workspaceScopeFromMentionedServers(mentionedServers),
    })
  }, [availableServers, buildMessageContext, permissionMode, selectedModel, updateUserMessage])

  const handleDeleteUserMessage = useCallback(async (messageId: string) => {
    const confirmed = await requestConfirm({
      description: t("deleteMessageConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return false
    }

    return deleteUserMessage(messageId)
  }, [deleteUserMessage, requestConfirm, t])

  const handleUseTemplate = (prompt: string) => {
    setDraft(prompt)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleCreateNewSession = async () => {
    if (isAssistantActive) {
      const confirmed = await requestConfirm({
        description: t("replaceRunningSessionConfirm"),
        variant: "destructive",
      })
      if (!confirmed) return
    }
    setDraft("")
    clearAttachments()

    if (sessionCreatingRef.current) {
      return
    }

    if (isCurrentSessionBlank) {
      history.setOpen(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }

    sessionCreatingRef.current = true
    setSessionCreating(true)

    try {
      const response = await startNewSession({
        model: selectedModel || undefined,
        permissionMode,
        scope: { kind: "global" },
      })

      if (response) {
        prependSessionListItem(response)
      }
    } finally {
      sessionCreatingRef.current = false
      setSessionCreating(false)
    }

    history.setOpen(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleRestoreSession = async (targetSessionId: string) => {
    if (!targetSessionId || sessionCreatingRef.current || history.renamingId) {
      return
    }

    if (targetSessionId === sessionId) {
      history.setOpen(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }

    const restored = await restoreSession(targetSessionId)
    if (restored) {
      history.setOpen(false)
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
      if (targetSessionId === sessionId) {
        detachSession()
      }
      toast.success("会话已删除")
    } else {
      toast.error(t("deleteSessionFailed"))
    }
  }

  const closeServerMention = useCallback(() => {
    setServerMention(null)
    setServerMentionIndex(0)
  }, [])

  const updateServerMention = useCallback((value: string, caretPosition: number | null) => {
    if (serverReferenceDisabled) {
      closeServerMention()
      return
    }

    const nextMention = getActiveServerMention(value, caretPosition)
    if (!nextMention) {
      closeServerMention()
      return
    }

    setServerMention(nextMention)
  }, [closeServerMention, serverReferenceDisabled])

  const handleDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextDraft = event.currentTarget.value
    setDraft(nextDraft)
    updateServerMention(nextDraft, event.currentTarget.selectionStart)
  }, [updateServerMention])

  const handleDraftCaretChange = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    updateServerMention(event.currentTarget.value, event.currentTarget.selectionStart)
  }, [updateServerMention])

  const handleDraftKeyUp = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return
    }

    updateServerMention(event.currentTarget.value, event.currentTarget.selectionStart)
  }, [updateServerMention])

  const serverMentionOpen = Boolean(serverMention) && !serverReferenceDisabled
  const serverMentionQuery = serverMention?.query.trim().toLowerCase() ?? ""
  const serverMentionOptions = useMemo(() => {
    const candidates = serverMentionQuery
      ? availableServers.filter((server) => getServerMentionSearchText(server).includes(serverMentionQuery))
      : availableServers

    return candidates.slice(0, SERVER_MENTION_LIMIT)
  }, [availableServers, serverMentionQuery])

  useEffect(() => {
    setServerMentionIndex(0)
  }, [serverMention?.start, serverMentionQuery])

  useEffect(() => {
    if (serverMentionIndex >= serverMentionOptions.length) {
      setServerMentionIndex(0)
    }
  }, [serverMentionIndex, serverMentionOptions.length])

  const getSelectedServerMentionElement = useCallback(() => {
    const selectedServer = serverMentionOptions[serverMentionIndex]
    return selectedServer
      ? serverMentionItemRefs.current.get(selectedServer.id)
      : null
  }, [serverMentionIndex, serverMentionOptions])

  useSynchronousSelectedItemScroll({
    enabled: serverMentionOpen,
    getSelectedElement: getSelectedServerMentionElement,
    listRef: serverMentionListRef,
    selectedKey: serverMentionIndex,
  })

  const selectedServerMentionValue = serverMentionOptions[serverMentionIndex]?.id ?? ""

  useEffect(() => {
    if (serverMentionOpen && availableServers.length === 0 && !serversLoading) {
      void loadServers()
    }
  }, [availableServers.length, loadServers, serverMentionOpen, serversLoading])

  const selectServerMention = useCallback((server: ManagedServer) => {
    const activeMention = serverMention
    if (!activeMention) {
      return
    }

    const mentionText = getServerMentionText(server)
    const suffix = draft.slice(activeMention.end)
    const suffixStartsWithWhitespace = /^\s/.test(suffix)
    const separator = suffix.length === 0 || !suffixStartsWithWhitespace ? " " : ""
    const nextDraft = `${draft.slice(0, activeMention.start)}${mentionText}${separator}${suffix}`
    const nextCaretPosition = activeMention.start + mentionText.length + (
      separator.length || (suffixStartsWithWhitespace ? 1 : 0)
    )

    setDraft(nextDraft)
    closeServerMention()

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }, [closeServerMention, draft, serverMention])

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!serverMentionOpen) {
      return
    }

    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setServerMentionIndex((current) => (
        serverMentionOptions.length === 0 ? 0 : (current + 1) % serverMentionOptions.length
      ))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setServerMentionIndex((current) => (
        serverMentionOptions.length === 0
          ? 0
          : (current - 1 + serverMentionOptions.length) % serverMentionOptions.length
      ))
      return
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      if (serverMentionOptions.length > 0) {
        selectServerMention(serverMentionOptions[serverMentionIndex] ?? serverMentionOptions[0])
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeServerMention()
    }
  }, [
    closeServerMention,
    selectServerMention,
    serverMentionIndex,
    serverMentionOpen,
    serverMentionOptions,
  ])

  const handleAttachmentSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    await addAttachmentFiles(files)
  }, [addAttachmentFiles])

  const handleAttachmentPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
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

  const actionButtonClass = "size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900"

  const historyPopover = (
    <AISessionHistoryPopover
      activeSessionId={sessionId}
      align="start"
      history={history}
      onDelete={handleDeleteSession}
      onRestore={handleRestoreSession}
      t={t}
      triggerClassName={actionButtonClass}
    />
  )

  const sessionToolbar = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={actionButtonClass}
        disabled={createSessionDisabled}
        onClick={() => void handleCreateNewSession()}
        aria-label={t("newSession")}
        title={t("newSession")}
      >
        {sessionCreating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <SquarePen className="size-4" />
        )}
      </Button>
      {historyPopover}
      <AIAssistantConfigPopover
        open={configOpen}
        onOpenChange={setConfigOpen}
        customConfigOnly={customConfigOnly}
        adapter={adapters?.aiSettings}
        onSaved={() => {
          void refetchAIConfig()
        }}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            aria-label={t("configureAI")}
            title={t("configureAI")}
          >
            <Settings2 className="size-4" />
          </Button>
        }
      />
    </>
  )
  const activeSessionTitle = history.items.find((item) => item.id === sessionId)?.title
    ?? session?.messages.find((message) => message.role === "user")?.content.trim()
    ?? t("pageTitle")
  const activeScopeLabel = session?.scope?.server_name || t("scopeGlobal")
  const statusLabel = t(
    session?.status === "running"
      ? "statusRunning"
      : session?.status === "waiting_confirmation"
        ? "statusWaitingConfirmation"
        : session?.status === "closed"
          ? "statusClosed"
          : "statusIdle"
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {confirmDialog}
      {!hidePageHeader && <PageHeader title={t("pageTitle")} />}

      <AIAssistantCommandBar
        title={activeSessionTitle}
        scope={activeScopeLabel}
        model={selectedModel ? (
          <AIModelControl
            value={selectedModel}
            models={models}
            onChange={setSelectedModel}
            disabled={modelSelectDisabled}
          />
        ) : undefined}
        permission={(
          <AIPermissionControl
            value={permissionMode}
            options={permissionOptions}
            onChange={setPermissionMode}
            disabled={isConfigChecking}
          />
        )}
        status={session?.status ?? "idle"}
        statusLabel={statusLabel}
        leading={onReturnToTerminal ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-ml-2 size-8 text-muted-foreground hover:text-foreground"
              aria-label="返回终端"
              title="返回终端"
              onClick={onReturnToTerminal}
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : undefined}
        actions={sessionToolbar}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden pb-4 md:pb-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              {hasTimeline ? (
                <Conversation className="h-full w-full [&>div]:scrollbar-custom">
                  <ConversationContent
                    className="min-h-full w-full px-4 py-6 md:px-6"
                  >
                    <AgentAIElementsTimeline
                      messages={uiMessages}
                      tText={t}
                      onUpdateUserMessage={handleUpdateUserMessage}
                      onDeleteUserMessage={handleDeleteUserMessage}
                      assistantLoadingState={assistantLoadingState}
                      className="mx-auto w-full max-w-5xl"
                    />
                  </ConversationContent>
                  <ConversationInitialScroll
                    enabled={Boolean(sessionId) && uiMessages.length > 0}
                    scrollKey={sessionId ? `${sessionId}:${uiMessages[0]?.id ?? ""}` : null}
                  />
                  <ConversationScrollButton />
                </Conversation>
              ) : (
                <PromptTemplateGrid onUseTemplate={handleUseTemplate} t={t} />
              )}
            </div>

            <div className="shrink-0 pt-4">
              {error && (
                <AgentNoticeCard tone="error" size="md" className="mx-auto mb-3 w-full max-w-5xl shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span>{error}</span>
                    <Button type="button" variant="ghost" size="icon" className="-my-1 size-7 shrink-0" onClick={clearError} aria-label={t("cancel")}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </AgentNoticeCard>
              )}

              <div className="mx-auto w-full max-w-5xl">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,text/*,.json,.yaml,.yml,.xml,.csv,.md,.log,.sh,.py,.js,.ts,.tsx,.go,.rs,.java,.sql"
                  className="hidden"
                  onChange={(event) => void handleAttachmentSelection(event)}
                />

                <ComposerReferenceChips
                  attachments={attachments}
                  onClearServers={() => undefined}
                  onRemoveAttachment={removeAttachment}
                  onToggleServer={() => undefined}
                  selectedServers={[]}
                  t={t}
                />

                <AgentApprovalQueue
                  tasks={agentSession.tasks}
                  messages={uiMessages}
                  tText={t}
                  onConfirmTask={confirmTask}
                  scope={session?.scope}
                  className="mb-2"
                />

                <PromptInput
                  className="ai-command-composer rounded-xl border border-border/70 bg-card/85 shadow-sm"
                  onSubmit={(message) => submit(message.text)}
                >
                  <Popover
                    open={serverMentionOpen}
                    onOpenChange={(open) => {
                      if (!open) {
                        closeServerMention()
                      }
                    }}
                  >
                    <PopoverAnchor asChild>
                      <PromptInputTextarea
                        ref={inputRef}
                        value={draft}
                        onChange={handleDraftChange}
                        onClick={handleDraftCaretChange}
                        onKeyDown={handleComposerKeyDown}
                        onPaste={handleAttachmentPaste}
                        onKeyUp={handleDraftKeyUp}
                        onSelect={handleDraftCaretChange}
                        placeholder={hasTimeline ? t("composerPlaceholder") : t("inputPlaceholderWithMention")}
                        minHeight={56}
                        maxHeight={180}
                        className="px-4 pt-3 text-sm"
                      />
                    </PopoverAnchor>
                    <PopoverContent
                      align="start"
                      side="top"
                      sideOffset={8}
                      onCloseAutoFocus={(event) => event.preventDefault()}
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      className="w-[min(34rem,calc(100vw-2rem))] overflow-hidden p-0 shadow-2xl"
                    >
                      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                          <ServerIcon className="size-3.5" />
                          <span className="truncate">{t("referenceServer")}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => void loadServers()}
                          disabled={serversLoading}
                          aria-label={t("referenceServerRefresh")}
                          title={t("referenceServerRefresh")}
                        >
                          <RefreshCw className={cn("size-3.5", serversLoading && "animate-spin")} />
                        </Button>
                      </div>

                      <Command
                        shouldFilter={false}
                        disablePointerSelection
                        value={selectedServerMentionValue}
                        className="bg-popover"
                      >
                        <CommandList ref={serverMentionListRef} className="max-h-72 p-1">
                          {serversLoading && availableServers.length === 0 ? (
                            <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              <span>{t("referenceServerLoading")}</span>
                            </div>
                          ) : serverMentionOptions.length === 0 ? (
                            <CommandEmpty className="px-3 py-8 text-center text-sm text-muted-foreground">
                              {t("referenceServerEmpty")}
                            </CommandEmpty>
                          ) : (
                            <CommandGroup className="p-0">
                              {serverMentionOptions.map((server, index) => {
                                const isSelected = index === serverMentionIndex

                                return (
                                  <CommandItem
                                    key={server.id}
                                    ref={(element) => {
                                      if (element) {
                                        serverMentionItemRefs.current.set(server.id, element)
                                      } else {
                                        serverMentionItemRefs.current.delete(server.id)
                                      }
                                    }}
                                    value={server.id}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseMove={() => setServerMentionIndex(index)}
                                    onSelect={() => selectServerMention(server)}
                                    className={cn(
                                      "gap-2 rounded-md px-2 py-2 text-foreground hover:bg-accent/70 data-[selected=true]:bg-transparent data-[selected=true]:text-foreground",
                                      isSelected && "!bg-accent !text-accent-foreground hover:!bg-accent"
                                    )}
                                  >
                                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] text-muted-foreground">
                                      @
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">
                                        {getServerDisplayName(server)}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {server.username}@{server.host}:{server.port}
                                      </span>
                                    </span>
                                    <span
                                      className={cn(
                                        "shrink-0 text-[10px] uppercase tracking-wide",
                                        server.status === "online" ? "text-emerald-600" : "text-muted-foreground"
                                      )}
                                    >
                                      {server.status}
                                    </span>
                                  </CommandItem>
                                )
                              })}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <PromptInputToolbar className="flex-wrap gap-3 px-2 py-1.5">
                    <PromptInputTools className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={attachmentDisabled}
                        aria-label={t("attachFile")}
                        title={t("attachFile")}
                      >
                        {attachmentsLoading ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                      </Button>

                      {showConfigAction && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 px-2.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground sm:text-sm"
                          onClick={() => setConfigOpen(true)}
                        >
                          {t("configureAI")}
                        </Button>
                      )}
                    </PromptInputTools>

                    <div className="ml-auto flex items-center gap-2">
                      {isAssistantActive ? (
                        <PromptInputSubmit
                          type="button"
                          status="streaming"
                          size="icon-sm"
                          className="h-9 w-9"
                          aria-label="中断回复"
                          title="中断回复"
                          onClick={() => void cancelSession()}
                        >
                          <Square className="size-4" />
                        </PromptInputSubmit>
                      ) : (
                        <PromptInputSubmit
                          disabled={!canAttemptSubmit}
                          size="icon-sm"
                          className="h-9 w-9"
                          aria-label={t("send")}
                          title={t("send")}
                        >
                          <Send className="size-4" />
                        </PromptInputSubmit>
                      )}
                    </div>
                  </PromptInputToolbar>
                </PromptInput>

                <div className="mt-2 text-center text-xs text-muted-foreground">
                  {t("safetyNotice")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
