
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react"
import { ArrowLeft, Check, History, Loader2, Pencil, Plus, RefreshCw, Search, Send, Server as ServerIcon, Settings2, Shield, Square, SquarePen, Trash2, X } from "lucide-react"

import { AgentAIElementsTimeline } from "@/components/ai-agent/agent-ai-elements-timeline"
import { AIAssistantConfigPopover } from "@/components/ai-agent/ai-config-popover"
import {
  ComposerReferenceChips,
  MAX_COMPOSER_ATTACHMENTS,
  PromptTemplateGrid,
  buildAgentMessageContext,
  createComposerAttachment,
  sortReferencedServers,
  type ComposerAttachment,
} from "@/components/ai-agent/composer"
import { PageHeader } from "@/components/page-header"
import { toast } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  PromptInput,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { AgentNoticeCard } from "@/components/ai-agent/agent-notice"
import { useAgentSession } from "@/hooks/use-agent-session"
import type { AgentSessionAdapter } from "@/hooks/use-agent-session"
import { useAIConfig } from "@/hooks/use-ai-config"
import type { AIConfigAdapter } from "@/hooks/use-ai-config"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { serversApi, type Server as ManagedServer } from "@/lib/api"
import { deleteAISession, listAISessions, renameAISession, type AgentSessionScope, type CreateSessionResponse, type PermissionMode, type SessionListItem, type SessionView } from "@/lib/api/ai-agent"
import type { AIAssistantConfigAdapter } from "@/components/ai-agent/ai-config-popover"
import type { ServerListResponse } from "@/lib/api/servers"
import { getServerDisplayName } from "@/lib/server-utils"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

const SESSION_LIST_LIMIT = 30
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

function createSessionListItem(response: CreateSessionResponse, title: string): SessionListItem {
  return createSessionListItemFromSession(response.session, title)
}

function createSessionListItemFromSession(
  session: SessionView,
  title: string,
  customTitle = false
): SessionListItem {
  return {
    id: session.id,
    model: session.model,
    permission_mode: session.permission_mode,
    status: session.status,
    title,
    custom_title: customTitle,
    message_count: session.messages.length,
    task_count: session.tasks.length,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }
}

function getDefaultSessionListTitle(session: SessionView, fallback: string) {
  const firstUserMessage = session.messages.find((message) => message.role === "user")?.content.trim()
  if (!firstUserMessage) {
    return fallback
  }

  const chars = Array.from(firstUserMessage)
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}...` : firstUserMessage
}

function formatSessionTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
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

export function AIAssistantWorkspaceView({
  hidePageHeader = false,
  customConfigOnly = false,
  onReturnToTerminal,
  adapters,
}: AIAssistantWorkspaceViewProps) {
  const { t } = useTranslation("aiAssistant")
  const { ready } = useAuthReady()
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
  const { isLoading, isConfigured, models, refetch: refetchAIConfig } = useAIConfig(adapters?.aiConfig)
  const agentSession = useAgentSession(adapters?.aiSession)
  const { session, sessionId, uiMessages, pendingConfirmationTasks, error, restoreLatestSession, restoreSession, startNewSession, sendMessage, confirmTask, cancelSession, closeSession } = agentSession

  const [draft, setDraft] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("balanced")
  const [availableServers, setAvailableServers] = useState<ManagedServer[]>([])
  const [serversLoading, setServersLoading] = useState(false)
  const [serverMention, setServerMention] = useState<{
    end: number
    query: string
    start: number
  } | null>(null)
  const [serverMentionIndex, setServerMentionIndex] = useState(0)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [sessionList, setSessionList] = useState<SessionListItem[]>([])
  const [sessionListLoading, setSessionListLoading] = useState(false)
  const [sessionListError, setSessionListError] = useState("")
  const [sessionSearch, setSessionSearch] = useState("")
  const [configOpen, setConfigOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessionCreating, setSessionCreating] = useState(false)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [sessionActionLoadingId, setSessionActionLoadingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionCreatingRef = useRef(false)

  useEffect(() => {
    if (models.length === 0) {
      setSelectedModel("")
      return
    }

    if (!selectedModel || !models.includes(selectedModel)) {
      setSelectedModel(models[0])
    }
  }, [models, selectedModel])

  useEffect(() => {
    if (!session?.id) {
      return
    }

    if (session.permission_mode) {
      setPermissionMode(session.permission_mode)
    }

    if (session.model && models.includes(session.model)) {
      setSelectedModel(session.model)
    }
  }, [models, session?.id, session?.model, session?.permission_mode])

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
  const isSessionRunning = session?.status === "running"
  const runningTasks = agentSession.tasks.filter((task) => task.status === "running" || task.status === "queued")
  const shouldShowLoadingIndicator =
    isSessionRunning &&
    runningTasks.length === 0 &&
    pendingConfirmationTasks.length === 0
  const assistantLoadingState = shouldShowLoadingIndicator ? "waiting" : false
  const isCurrentSessionBlank = Boolean(
    session &&
    session.status !== "closed" &&
    uiMessages.length === 0 &&
    agentSession.tasks.length === 0
  )
  const createSessionDisabled = !ready || isLoading || !isConfigured || sessionCreating
  const canAttemptSubmit = Boolean(draft.trim())

  const buildMessageContext = useCallback(
    (messageText: string) => buildAgentMessageContext({
      attachments,
      selectedServers: getMentionedServers(messageText, availableServers),
      t,
    }),
    [attachments, availableServers, t]
  )

  const prependSessionListItem = useCallback((response: CreateSessionResponse) => {
    if (sessionSearch.trim()) {
      return
    }

    setSessionList((current) => [
      createSessionListItem(response, t("newSession")),
      ...current.filter((item) => item.id !== response.session_id),
    ].slice(0, SESSION_LIST_LIMIT))
  }, [sessionSearch, t])

  useEffect(() => {
    if (!session?.id || !historyOpen) {
      return
    }

    setSessionList((current) => {
      const existing = current.find((item) => item.id === session.id)
      const title = existing?.custom_title
        ? existing.title
        : getDefaultSessionListTitle(session, existing?.title || t("newSession"))
      const nextItem = createSessionListItemFromSession(session, title, existing?.custom_title ?? false)
      const query = sessionSearch.trim().toLowerCase()
      if (query && !nextItem.title.toLowerCase().includes(query)) {
        return current.filter((item) => item.id !== session.id)
      }

      return [
        nextItem,
        ...current.filter((item) => item.id !== session.id),
      ].slice(0, SESSION_LIST_LIMIT)
    })
  }, [historyOpen, session, sessionSearch, t])

  const submit = async (messageText = draft) => {
    const normalizedDraft = messageText.trim()
    const submittedServers = getMentionedServers(normalizedDraft, availableServers)
    const submittedScope = workspaceScopeFromMentionedServers(submittedServers)
    const contextText = buildMessageContext(normalizedDraft)
    const blockReasons: string[] = []

    if (!normalizedDraft) {
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
    if (session && session.status !== "idle" && session.status !== "closed") {
      blockReasons.push(`session_${session.status}`)
    }

    if (blockReasons.length > 0) {
      if (normalizedDraft) {
        if (!ready || isLoading) {
          toast.info(t("checkingConfig"))
        } else if (!isConfigured) {
          toast.info(t("aiNotConfigured"))
        } else if (attachmentsLoading || sessionCreatingRef.current) {
          toast.info(t("loading"))
        } else if (session && session.status !== "idle" && session.status !== "closed") {
          toast.info(
            pendingConfirmationTasks.length > 0
              ? t("pendingToolsHint", { count: pendingConfirmationTasks.length })
              : t(session.status === "waiting_confirmation" ? "statusWaitingConfirmation" : "statusRunning")
          )
        }
      }
      return
    }

    const submittedAttachments = attachments
    setDraft("")
    setAttachments([])

    if (!sessionId || session?.status === "closed") {
      sessionCreatingRef.current = true
      setSessionCreating(true)

      let response: CreateSessionResponse | null = null
      try {
        response = await startNewSession({
          model: selectedModel || undefined,
          permissionMode,
          scope: submittedScope,
        })
      } finally {
        sessionCreatingRef.current = false
        setSessionCreating(false)
      }

      if (!response) {
        setDraft((current) => current || messageText)
        setAttachments((current) => current.length > 0 ? current : submittedAttachments)
        return
      }
      prependSessionListItem(response)
    }

    const sent = await sendMessage(normalizedDraft, contextText, selectedModel || undefined, permissionMode, submittedScope)
    if (!sent) {
      setDraft((current) => current || messageText)
      setAttachments((current) => current.length > 0 ? current : submittedAttachments)
    }
  }

  const handleUseTemplate = (prompt: string) => {
    setDraft(prompt)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleCreateNewSession = async () => {
    setDraft("")
    setAttachments([])

    if (sessionCreatingRef.current) {
      return
    }

    if (isCurrentSessionBlank) {
      setHistoryOpen(false)
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

    setHistoryOpen(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const loadSessionList = useCallback(async () => {
    if (!ready || isLoading || !isConfigured) {
      return
    }

    setSessionListLoading(true)
    try {
      setSessionListError("")
      const response = await (adapters?.listAISessions ?? listAISessions)({ limit: SESSION_LIST_LIMIT, q: sessionSearch })
      setSessionList(response.items)
    } catch {
      setSessionListError(t("sessionListLoadFailed"))
    } finally {
      setSessionListLoading(false)
    }
  }, [adapters?.listAISessions, isConfigured, isLoading, ready, sessionSearch, t])

  useEffect(() => {
    if (historyOpen) {
      void loadSessionList()
    }
  }, [historyOpen, loadSessionList])

  const handleRestoreSession = async (targetSessionId: string) => {
    if (!targetSessionId || sessionCreatingRef.current || renamingSessionId) {
      return
    }

    if (targetSessionId === sessionId) {
      setHistoryOpen(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }

    const restored = await restoreSession(targetSessionId)
    if (restored) {
      setHistoryOpen(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }

  const beginRenameSession = (item: SessionListItem) => {
    setRenamingSessionId(item.id)
    setRenameDraft(item.title)
  }

  const cancelRenameSession = () => {
    setRenamingSessionId(null)
    setRenameDraft("")
  }

  const submitRenameSession = async (targetSessionId: string) => {
    const title = renameDraft.trim()
    if (sessionActionLoadingId) {
      return
    }

    if (!title) {
      toast.error("会话名称不能为空")
      return
    }

    setSessionActionLoadingId(targetSessionId)
    try {
      await (adapters?.renameAISession ?? renameAISession)(targetSessionId, title)
      cancelRenameSession()
      setSessionList((current) => current.map((item) => (
        item.id === targetSessionId
          ? { ...item, title, custom_title: true, updated_at: new Date().toISOString() }
          : item
      )))
      toast.success("会话已重命名")
    } catch {
      toast.error(t("renameSessionFailed"))
    } finally {
      setSessionActionLoadingId(null)
    }
  }

  const handleDeleteSession = async (targetSessionId: string) => {
    if (!targetSessionId || sessionActionLoadingId) {
      return
    }

    const confirmed = await requestConfirm({
      description: t("deleteSessionConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    setSessionActionLoadingId(targetSessionId)
    try {
      await (adapters?.deleteAISession ?? deleteAISession)(targetSessionId)
      setSessionList((current) => current.filter((item) => item.id !== targetSessionId))
      if (targetSessionId === sessionId) {
        await closeSession()
      }
      if (renamingSessionId === targetSessionId) {
        cancelRenameSession()
      }
      toast.success("会话已删除")
    } catch {
      toast.error(t("deleteSessionFailed"))
    } finally {
      setSessionActionLoadingId(null)
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

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  const handleAttachmentSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files

    if (!fileList || fileList.length === 0) {
      return
    }

    const files = Array.from(fileList)
    const remainingSlots = MAX_COMPOSER_ATTACHMENTS - attachments.length

    if (remainingSlots <= 0) {
      toast.info(t("attachmentLimitHint", { count: MAX_COMPOSER_ATTACHMENTS }))
      event.target.value = ""
      return
    }

    if (files.length > remainingSlots) {
      toast.info(t("attachmentLimitHint", { count: MAX_COMPOSER_ATTACHMENTS }))
    }

    setAttachmentsLoading(true)

    try {
      const nextAttachments = await Promise.all(
        files.slice(0, remainingSlots).map(async (file) => {
          try {
            return await createComposerAttachment(file)
          } catch {
            toast.error(t("attachmentReadFailed", { file: file.name }))
            return null
          }
        })
      )

      setAttachments((current) => [
        ...current,
        ...nextAttachments.filter((attachment): attachment is ComposerAttachment => attachment !== null),
      ])
    } finally {
      setAttachmentsLoading(false)
      event.target.value = ""
    }
  }, [attachments.length, t])

  const actionButtonClass = "size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900"

  const historyPopover = (
    <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={actionButtonClass}
          aria-label={t("sidebarTitle")}
          title={t("sidebarTitle")}
        >
          <History className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[330px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border-zinc-200/80 p-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-8 border-transparent bg-muted/50 pl-8 pr-8 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {sessionSearch && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setSessionSearch("")}
                aria-label={t("cancel")}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[360px]">
          <div className="p-2">
            {sessionListLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("loading")}</span>
              </div>
            ) : sessionListError ? (
              <div className="px-3 py-10 text-center text-sm text-destructive">
                {sessionListError}
              </div>
            ) : sessionList.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {t("sessionListEmpty")}
              </div>
            ) : (
              <div className="space-y-1">
                {sessionList.map((item) => {
                  const isActive = item.id === sessionId
                  const isRenaming = renamingSessionId === item.id
                  const isActionLoading = sessionActionLoadingId === item.id

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left transition-colors",
                        isActive
                          ? "bg-accent text-foreground dark:bg-zinc-900"
                          : "text-foreground hover:bg-accent dark:hover:bg-zinc-900"
                      )}
                      onClick={() => void handleRestoreSession(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (isRenaming) {
                          return
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          void handleRestoreSession(item.id)
                        }
                      }}
                    >
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                              <Input
                                autoFocus
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    void submitRenameSession(item.id)
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault()
                                    cancelRenameSession()
                                  }
                                }}
                                className="h-7 min-w-0 text-xs"
                                disabled={isActionLoading}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                                disabled={isActionLoading}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void submitRenameSession(item.id)
                                }}
                                aria-label={t("saveSessionTitle")}
                                title={t("saveSessionTitle")}
                              >
                                {isActionLoading ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Check className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                                disabled={isActionLoading}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  cancelRenameSession()
                                }}
                                aria-label={t("cancel")}
                                title={t("cancel")}
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="truncate text-sm font-medium">
                              {item.title}
                            </div>
                          )}
                        </div>

                        {!isRenaming && (
                          <div
                            className="flex shrink-0 items-center gap-0.5 opacity-100"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground dark:hover:bg-zinc-800"
                              disabled={Boolean(sessionActionLoadingId)}
                              onClick={() => beginRenameSession(item)}
                              aria-label={t("rename")}
                              title={t("rename")}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-md text-muted-foreground hover:bg-background/80 hover:text-destructive dark:hover:bg-zinc-800"
                              disabled={Boolean(sessionActionLoadingId)}
                              onClick={() => void handleDeleteSession(item.id)}
                              aria-label={t("delete")}
                              title={t("delete")}
                            >
                              {isActionLoading ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{t("sidebarMessageCount", { count: item.message_count })}</span>
                        <span className="shrink-0">{formatSessionTime(item.updated_at)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {confirmDialog}
      {!hidePageHeader && <PageHeader title={t("pageTitle")} />}

      <div className="shrink-0 px-4 pb-1 md:px-4">
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
            {sessionToolbar}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden pb-4 md:pb-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              {hasTimeline ? (
                <Conversation className="h-full w-full">
                  <ConversationContent
                    className="h-full w-full overflow-y-auto px-4 py-6 scrollbar-custom md:px-6"
                  >
                    <AgentAIElementsTimeline
                      messages={uiMessages}
                      tText={t}
                      onConfirmTask={confirmTask}
                      assistantLoadingState={assistantLoadingState}
                      className="mx-auto w-full max-w-5xl"
                    />
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
              ) : (
                <PromptTemplateGrid onUseTemplate={handleUseTemplate} t={t} />
              )}
            </div>

            <div className="shrink-0 pt-4">
              {error && (
                <AgentNoticeCard tone="error" size="md" className="mx-auto mb-3 w-full max-w-5xl shadow-sm">
                  {error}
                </AgentNoticeCard>
              )}

              <div className="mx-auto w-full max-w-5xl">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
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

                <PromptInput
                  className="border-border/0 bg-card/0 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/0"
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

                      <div className="max-h-72 overflow-y-auto p-1 scrollbar-custom" role="listbox">
                        {serversLoading && availableServers.length === 0 ? (
                          <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>{t("referenceServerLoading")}</span>
                          </div>
                        ) : serverMentionOptions.length === 0 ? (
                          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                            {t("referenceServerEmpty")}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {serverMentionOptions.map((server, index) => {
                              const isActive = index === serverMentionIndex

                              return (
                                <button
                                  key={server.id}
                                  type="button"
                                  role="option"
                                  aria-selected={isActive}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                                    isActive
                                      ? "bg-accent text-accent-foreground"
                                      : "text-foreground hover:bg-accent/70"
                                  )}
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    selectServerMention(server)
                                  }}
                                >
                                  <span
                                    className={cn(
                                      "flex size-5 shrink-0 items-center justify-center rounded-md border text-[10px]",
                                      "border-border text-muted-foreground"
                                    )}
                                  >
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
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <PromptInputToolbar className="flex-wrap gap-3 px-2 py-1.5">
                    <PromptInputTools className="flex flex-wrap items-center gap-2">
                      <PromptInputModelSelect
                        value={selectedModel}
                        onValueChange={setSelectedModel}
                        disabled={modelSelectDisabled}
                      >
                      <PromptInputModelSelectTrigger className="h-9 rounded-md border-none !bg-transparent px-2.5 text-xs font-normal text-muted-foreground !shadow-none hover:!bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:!bg-transparent dark:hover:!bg-transparent [aria-expanded='true']:!bg-transparent [aria-expanded='true']:text-foreground sm:text-sm">
                        <PromptInputModelSelectValue placeholder={t("modelPlaceholder")} />
                        </PromptInputModelSelectTrigger>
                      <PromptInputModelSelectContent>
                          {models.map((model) => (
                          <PromptInputModelSelectItem key={model} value={model}>
                              {model}
                            </PromptInputModelSelectItem>
                          ))}
                        </PromptInputModelSelectContent>
                      </PromptInputModelSelect>

                    <PromptInputModelSelect
                        value={permissionMode}
                        onValueChange={(value) => setPermissionMode(value as PermissionMode)}
                        disabled={isConfigChecking}
                      >
                      <PromptInputModelSelectTrigger className="h-9 rounded-md border-none !bg-transparent px-2.5 text-xs font-normal text-muted-foreground !shadow-none hover:!bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:!bg-transparent dark:hover:!bg-transparent [aria-expanded='true']:!bg-transparent [aria-expanded='true']:text-foreground sm:text-sm">
                        <PromptInputModelSelectValue />
                        </PromptInputModelSelectTrigger>
                      <PromptInputModelSelectContent>
                          {permissionOptions.map((option) => (
                          <PromptInputModelSelectItem key={option.value} value={option.value}>
                              {option.label}
                            </PromptInputModelSelectItem>
                          ))}
                        </PromptInputModelSelectContent>
                      </PromptInputModelSelect>

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
                      {ready && isConfigured && pendingConfirmationTasks.length > 0 && (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          <Shield className="size-3" />
                          {pendingConfirmationTasks.length}
                        </Badge>
                      )}
                      {isSessionRunning ? (
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
