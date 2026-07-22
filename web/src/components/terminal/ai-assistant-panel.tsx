
import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties, type ChangeEvent, type ClipboardEvent, type PointerEvent } from "react"
import { Link } from "react-router-dom"
import {
  Check,
  History,
  Loader2,
  Plus,
  Pencil,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { AgentAIElementsTimeline, getAgentToolActivity } from "@/components/ai-agent/agent-ai-elements-timeline"
import { AgentApprovalQueue } from "@/components/ai-agent/agent-approval-queue"
import { AIAssistantConfigPopover } from "@/components/ai-agent/ai-config-popover"
import {
  ComposerReferenceChips,
  MAX_COMPOSER_ATTACHMENTS,
  createComposerAttachment,
  toAgentImageAttachments,
  type ComposerAttachment,
} from "@/components/ai-agent/composer"
import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Conversation,
  ConversationContent,
  ConversationInitialScroll,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
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
import { useAIConfig } from "@/hooks/use-ai-config"
import { useAgentSession } from "@/hooks/use-agent-session"
import {
  deleteAISession,
  listAISessions,
  renameAISession,
  type AgentSessionScope,
  type CreateSessionResponse,
  type PermissionMode,
  type SessionListItem,
} from "@/lib/api/ai-agent"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { cn } from "@/lib/utils"
import type { TerminalSession } from "./types"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"

const ANIMATION_DELAY = 160
const PANEL_OPEN_SETTLE_DELAY = 180
const SESSION_LIST_LIMIT = 30
const PANEL_WIDTH_STORAGE_KEY = "easyssh:terminal-ai-assistant:panel-width"
const DEFAULT_PANEL_WIDTH = 420
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 720

interface AiAssistantPanelProps {
  isOpen: boolean
  onClose: () => void
  terminalSession: TerminalSession
  adapters?: AIAssistantWorkspaceAdapters
  background: {
    color: string
    image?: string
    imageOpacity: number
  }
}

const TERMINAL_AI_SESSION_STORAGE_KEY = "easyssh:terminal-ai-assistant:sessions"

function readTerminalAISessionMap() {
  if (typeof window === "undefined") {
    return {} as Record<string, string>
  }

  try {
    const storedValue = window.localStorage.getItem(TERMINAL_AI_SESSION_STORAGE_KEY)
    if (!storedValue) {
      return {} as Record<string, string>
    }

    const parsed = JSON.parse(storedValue)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {}
  } catch {
    return {} as Record<string, string>
  }
}

function getStoredTerminalAISessionId(terminalSessionId: string) {
  return readTerminalAISessionMap()[terminalSessionId] || null
}

function storeTerminalAISessionId(terminalSessionId: string, aiSessionId: string) {
  if (typeof window === "undefined" || !terminalSessionId || !aiSessionId) {
    return
  }

  try {
    const nextMap = readTerminalAISessionMap()
    nextMap[terminalSessionId] = aiSessionId
    window.localStorage.setItem(TERMINAL_AI_SESSION_STORAGE_KEY, JSON.stringify(nextMap))
  } catch {
    // ignore unavailable storage
  }
}

function removeStoredTerminalAISessionId(terminalSessionId: string, aiSessionId?: string) {
  if (typeof window === "undefined" || !terminalSessionId) {
    return
  }

  try {
    const nextMap = readTerminalAISessionMap()
    if (!aiSessionId || nextMap[terminalSessionId] === aiSessionId) {
      delete nextMap[terminalSessionId]
      window.localStorage.setItem(TERMINAL_AI_SESSION_STORAGE_KEY, JSON.stringify(nextMap))
    }
  } catch {
    // ignore unavailable storage
  }
}

function assertDesktopAIAdapters(layout: string | undefined, adapters?: AIAssistantWorkspaceAdapters) {
  if (layout !== "desktop") {
    return
  }

  if (
    !adapters?.aiConfig ||
    !adapters.aiSettings ||
    !adapters.aiSession ||
    !adapters.listAISessions ||
    !adapters.renameAISession ||
    !adapters.deleteAISession
  ) {
    throw new Error("Desktop terminal AI requires local AI session and settings adapters")
  }
}

function createSessionListItem(
  response: CreateSessionResponse,
  title: string
): SessionListItem {
  return {
    id: response.session_id,
    model: response.session.model,
    permission_mode: response.session.permission_mode,
    status: response.session.status,
    title,
    custom_title: false,
    message_count: response.session.messages.length,
    task_count: response.session.tasks.length,
    created_at: response.session.created_at,
    updated_at: response.session.updated_at,
  }
}

function formatSessionTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function AiAssistantPanel({
  isOpen,
  onClose,
  terminalSession,
  adapters,
  background,
}: AiAssistantPanelProps) {
  const { t: tAI } = useTranslation("aiAssistant")
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
  const workspace = useOptionalSshWorkspace()
  const preferences = workspace?.adapters.preferences
  const canUseWebSettingsFallback = workspace?.layout !== "desktop"
  assertDesktopAIAdapters(workspace?.layout, adapters)
  const {
    isConfigured,
    isLoading: isConfigLoading,
    models,
    model: defaultModel,
    refetch: refetchAIConfig,
  } = useAIConfig(adapters?.aiConfig)
  const {
    session,
    sessionId,
    transport,
    chatStatus,
    uiMessages,
    tasks,
    error,
    canSend: canSendToSession,
    restoreSession,
    startNewSession,
    sendMessage,
    updateMessage: updateUserMessage,
    deleteMessage: deleteUserMessage,
    confirmTask,
    cancelSession,
    closeSession,
  } = useAgentSession(adapters?.aiSession)
  const listSessions = adapters?.listAISessions ?? listAISessions
  const renameSession = adapters?.renameAISession ?? renameAISession
  const deleteSession = adapters?.deleteAISession ?? deleteAISession

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [model, setModel] = useState("auto")
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("balanced")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState("")
  const [sessionList, setSessionList] = useState<SessionListItem[]>([])
  const [sessionListLoading, setSessionListLoading] = useState(false)
  const [sessionListError, setSessionListError] = useState("")
  const [sessionCreating, setSessionCreating] = useState(false)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [sessionActionLoadingId, setSessionActionLoadingId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isOpenSettled, setIsOpenSettled] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const sessionCreatingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  const [panelWidthStorageReady, setPanelWidthStorageReady] = useState(false)
  const resizeFrameRef = useRef<number | null>(null)
  const pendingPanelWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  const restoreAttemptKeyRef = useRef<string | null>(null)

  const terminalScope = useMemo<AgentSessionScope>(() => ({
    kind: "terminal",
    terminal_session_id: terminalSession.id,
    server_id: terminalSession.serverId,
    server_name: terminalSession.serverName,
    host: terminalSession.host,
    port: terminalSession.port,
    username: terminalSession.username,
  }), [
    terminalSession.host,
    terminalSession.id,
    terminalSession.port,
    terminalSession.serverId,
    terminalSession.serverName,
    terminalSession.username,
  ])

  const permissionOptions = useMemo(
    () => [
      {
        value: "readonly" as const,
        label: tAI("permissionModeReadonly"),
        description: tAI("permissionModeReadonlyDesc"),
      },
      {
        value: "balanced" as const,
        label: tAI("permissionModeBalanced"),
        description: tAI("permissionModeBalancedDesc"),
      },
      {
        value: "privileged" as const,
        label: tAI("permissionModePrivileged"),
        description: tAI("permissionModePrivilegedDesc"),
      },
    ],
    [tAI]
  )

  const activePermissionOption = permissionOptions.find((option) => option.value === permissionMode) || permissionOptions[1]
  const terminalContextText = useMemo(() => {
    const lines = [
      tAI("terminalContextHeader"),
      `- terminal_session_id: ${terminalSession.id}`,
    ]

    if (terminalSession.serverId) {
      lines.push(`- server_id: ${terminalSession.serverId}`)
    }
    if (terminalSession.serverName) {
      lines.push(`- server_name: ${terminalSession.serverName}`)
    }
    if (terminalSession.username || terminalSession.host || terminalSession.port) {
      const target = `${terminalSession.username ? `${terminalSession.username}@` : ""}${terminalSession.host || ""}${terminalSession.port ? `:${terminalSession.port}` : ""}`
      if (target) {
        lines.push(`- connection: ${target}`)
      }
    }

    lines.push(tAI("terminalContextRule"))
    return lines.join("\n")
  }, [
    tAI,
    terminalSession.host,
    terminalSession.id,
    terminalSession.port,
    terminalSession.serverId,
    terminalSession.serverName,
    terminalSession.username,
  ])

  const modelOptions = models.length > 0 ? models : ["auto"]
  const resolvedModel =
    model && modelOptions.includes(model)
      ? model
      : (
          defaultModel && modelOptions.includes(defaultModel)
            ? defaultModel
            : modelOptions[0]
        )
  const activeModel = resolvedModel === "auto" ? undefined : resolvedModel
  const messageCount = uiMessages.length
  const isSessionRunning = session?.status === "running"
  const isChatRequestActive = chatStatus === "submitted" || chatStatus === "streaming"
  const isAssistantActive = isSessionRunning || isChatRequestActive
  const toolActivity = getAgentToolActivity(uiMessages)
  const shouldShowLoadingIndicator =
    isAssistantActive &&
    !toolActivity.hasActiveTools
  const assistantLoadingState = shouldShowLoadingIndicator ? "thinking" : false
  const canSend =
    (!!input.trim() || attachments.some((attachment) => attachment.source === "image")) &&
    isConfigured &&
    !isConfigLoading &&
    !sessionCreating && !attachmentsLoading &&
    !isChatRequestActive &&
    (canSendToSession || (!session && transport === "idle") || session?.status === "closed")
  const createSessionDisabled = !isConfigured || isConfigLoading || sessionCreating
  const isCurrentSessionBlank = Boolean(
    session &&
    session.status !== "closed" &&
    uiMessages.length === 0 &&
    tasks.length === 0
  )
  useEffect(() => {
    if (session?.permission_mode) {
      setPermissionMode(session.permission_mode)
    }
  }, [session?.permission_mode])

  useEffect(() => {
    if (!isOpen) {
      setHistoryOpen(false)
      setIsOpenSettled(false)
      return
    }

    let timer = 0
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        setIsOpenSettled(true)
      }, PANEL_OPEN_SETTLE_DELAY)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpenSettled) {
      return
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, ANIMATION_DELAY)

    return () => window.clearTimeout(timer)
  }, [isOpenSettled])

  useEffect(() => {
    if (!isOpenSettled || !isConfigured || isConfigLoading || session || transport !== "idle" || error) {
      return
    }

    if (restoreAttemptKeyRef.current === terminalSession.id) {
      return
    }
    restoreAttemptKeyRef.current = terminalSession.id

    const restoreLatestTerminalSession = async () => {
      try {
        const response = await listSessions({ limit: 1, scope: terminalScope })
        const latestSessionId = response.items[0]?.id
        if (!latestSessionId) {
          return
        }

        const restored = await restoreSession(latestSessionId, { silent: true })
        if (restored) {
          storeTerminalAISessionId(terminalSession.id, latestSessionId)
        }
      } catch {
        // Opening the panel should stay instant even if history lookup fails.
      }
    }

    const storedSessionId = getStoredTerminalAISessionId(terminalSession.id)
    if (storedSessionId) {
      void restoreSession(storedSessionId, { silent: true }).then((restored) => {
        if (restored) {
          return
        }

        removeStoredTerminalAISessionId(terminalSession.id, storedSessionId)
        void restoreLatestTerminalSession()
      })
      return
    }

    void restoreLatestTerminalSession()
  }, [
    error,
    isOpenSettled,
    isConfigured,
    isConfigLoading,
    listSessions,
    restoreSession,
    session,
    terminalScope,
    terminalSession.id,
    transport,
  ])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleEscClose = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }

      onClose()
    }

    window.addEventListener("keydown", handleEscClose)
    return () => {
      window.removeEventListener("keydown", handleEscClose)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    try {
      const storedValue = preferences?.getString(PANEL_WIDTH_STORAGE_KEY)
      const nextWidth = storedValue ? Number(storedValue) : DEFAULT_PANEL_WIDTH

      if (Number.isFinite(nextWidth)) {
        setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, nextWidth)))
      }
    } catch {
      // ignore unavailable storage
    } finally {
      setPanelWidthStorageReady(true)
    }
  }, [preferences])

  useEffect(() => {
    if (!panelWidthStorageReady) {
      return
    }
    if (isResizing) {
      return
    }

    void preferences?.setString(PANEL_WIDTH_STORAGE_KEY, String(panelWidth))
  }, [isResizing, panelWidth, panelWidthStorageReady, preferences])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isResizing])

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  const handleResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isOpen) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartXRef.current = event.clientX
    dragStartWidthRef.current = panelRef.current?.getBoundingClientRect().width || panelWidth
    pendingPanelWidthRef.current = dragStartWidthRef.current
    setIsResizing(true)
  }, [isOpen, panelWidth])

  const handleResizeMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) {
      return
    }

    const deltaX = dragStartXRef.current - event.clientX
    const nextWidth = Math.min(
      MAX_PANEL_WIDTH,
      Math.max(MIN_PANEL_WIDTH, dragStartWidthRef.current + deltaX)
    )

    pendingPanelWidthRef.current = nextWidth

    if (resizeFrameRef.current !== null) {
      return
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      setPanelWidth(pendingPanelWidthRef.current)
      resizeFrameRef.current = null
    })
  }, [isResizing])

  const handleResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) {
      return
    }

    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore missing capture
    }
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    setPanelWidth(pendingPanelWidthRef.current)
    setIsResizing(false)
  }, [isResizing])

  const loadSessionList = useCallback(async () => {
    if (!isConfigured || isConfigLoading) {
      return
    }

    setSessionListLoading(true)
    setSessionListError("")

    try {
      const response = await listSessions({
        limit: SESSION_LIST_LIMIT,
        q: sessionSearch,
        scope: terminalScope,
      })
      setSessionList(response.items)
    } catch {
      setSessionListError(tAI("sessionListLoadFailed"))
    } finally {
      setSessionListLoading(false)
    }
  }, [isConfigured, isConfigLoading, listSessions, sessionSearch, tAI, terminalScope])

  useEffect(() => {
    if (historyOpen) {
      void loadSessionList()
    }
  }, [historyOpen, loadSessionList])

  const prependSessionListItem = useCallback((response: CreateSessionResponse) => {
    if (sessionSearch.trim()) {
      return
    }

    setSessionList((current) => [
      createSessionListItem(response, tAI("newSession")),
      ...current.filter((item) => item.id !== response.session_id),
    ].slice(0, SESSION_LIST_LIMIT))
  }, [sessionSearch, tAI])

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const handleCreateNewSession = useCallback(async () => {
    setInput("")

    if (createSessionDisabled || sessionCreatingRef.current) {
      return
    }

    if (isCurrentSessionBlank) {
      setHistoryOpen(false)
      focusComposer()
      return
    }

    sessionCreatingRef.current = true
    setSessionCreating(true)

    try {
      const response = await startNewSession({
        model: activeModel,
        permissionMode,
        scope: terminalScope,
      })

      if (response) {
        storeTerminalAISessionId(terminalSession.id, response.session_id)
        prependSessionListItem(response)
      }
    } finally {
      sessionCreatingRef.current = false
      setSessionCreating(false)
    }

    setHistoryOpen(false)
    focusComposer()
  }, [
    activeModel,
    createSessionDisabled,
    focusComposer,
    isCurrentSessionBlank,
    permissionMode,
    prependSessionListItem,
    startNewSession,
    terminalScope,
    terminalSession.id,
  ])

  const handleRestoreSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId || sessionCreatingRef.current || renamingSessionId) {
      return
    }

    if (targetSessionId === sessionId) {
      setHistoryOpen(false)
      focusComposer()
      return
    }

    const restored = await restoreSession(targetSessionId)
    if (restored) {
      storeTerminalAISessionId(terminalSession.id, targetSessionId)
      setHistoryOpen(false)
      focusComposer()
    }
  }, [focusComposer, renamingSessionId, restoreSession, sessionId, terminalSession.id])

  const beginRenameSession = useCallback((item: SessionListItem) => {
    setRenamingSessionId(item.id)
    setRenameDraft(item.title)
  }, [])

  const cancelRenameSession = useCallback(() => {
    setRenamingSessionId(null)
    setRenameDraft("")
  }, [])

  const submitRenameSession = useCallback(async (targetSessionId: string) => {
    const title = renameDraft.trim()
    if (!title || sessionActionLoadingId) {
      return
    }

    setSessionActionLoadingId(targetSessionId)
    try {
      await renameSession(targetSessionId, title)
      setSessionList((current) => current.map((item) => (
        item.id === targetSessionId
          ? { ...item, title, custom_title: true, updated_at: new Date().toISOString() }
          : item
      )))
      cancelRenameSession()
    } catch {
      setSessionListError(tAI("renameSessionFailed"))
    } finally {
      setSessionActionLoadingId(null)
    }
  }, [cancelRenameSession, renameDraft, renameSession, sessionActionLoadingId, tAI])

  const handleDeleteSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId || sessionActionLoadingId) {
      return
    }

    const confirmed = await requestConfirm({
      description: tAI("deleteSessionConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    setSessionActionLoadingId(targetSessionId)
    try {
      await deleteSession(targetSessionId)
      setSessionList((current) => current.filter((item) => item.id !== targetSessionId))
      removeStoredTerminalAISessionId(terminalSession.id, targetSessionId)
      if (targetSessionId === sessionId) {
        await closeSession()
      }
      if (renamingSessionId === targetSessionId) {
        cancelRenameSession()
      }
    } catch {
      setSessionListError(tAI("deleteSessionFailed"))
    } finally {
      setSessionActionLoadingId(null)
    }
  }, [
    cancelRenameSession,
    closeSession,
    deleteSession,
    renamingSessionId,
    requestConfirm,
    sessionActionLoadingId,
    sessionId,
    tAI,
    terminalSession.id,
  ])

  const handleUpdateUserMessage = useCallback(async (messageId: string, content: string) => {
    return updateUserMessage(messageId, content, {
      regenerate: true,
      contextText: terminalContextText,
      model: activeModel,
      permissionMode,
      scope: terminalScope,
    })
  }, [activeModel, permissionMode, terminalContextText, terminalScope, updateUserMessage])

  const handleDeleteUserMessage = useCallback(async (messageId: string) => {
    const confirmed = await requestConfirm({
      description: tAI("deleteMessageConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return false
    }

    return deleteUserMessage(messageId)
  }, [deleteUserMessage, requestConfirm, tAI])

  const addAttachmentFiles = useCallback(async (files: File[]) => {
    const remainingSlots = MAX_COMPOSER_ATTACHMENTS - attachments.length
    if (files.length === 0 || remainingSlots <= 0) {
      return
    }
    setAttachmentsLoading(true)
    try {
      const next = await Promise.all(
        files.slice(0, remainingSlots).map(async (file) => {
          try {
            return await createComposerAttachment(file)
          } catch {
            return null
          }
        })
      )
      setAttachments((current) => [
        ...current,
        ...next.filter((attachment): attachment is ComposerAttachment => attachment !== null),
      ])
    } finally {
      setAttachmentsLoading(false)
    }
  }, [attachments.length])

  const handleAttachmentSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    void addAttachmentFiles(files)
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

  const handleSubmit = useCallback(async (messageText = input) => {
    const normalizedInput = messageText.trim()
    const submittedAttachments = attachments
    if ((!normalizedInput && !submittedAttachments.some((attachment) => attachment.source === "image")) || !isConfigured || isConfigLoading || sessionCreatingRef.current) {
      return
    }

    if (isChatRequestActive || (session && session.status !== "closed" && !canSendToSession)) {
      return
    }

    setInput("")
    setAttachments([])

    if (!session || session.status === "closed") {
      sessionCreatingRef.current = true
      setSessionCreating(true)

      let response: CreateSessionResponse | null = null
      try {
        response = await startNewSession({
          model: activeModel,
          permissionMode,
          scope: terminalScope,
        })
      } finally {
        sessionCreatingRef.current = false
        setSessionCreating(false)
      }

      if (!response) {
        setInput((current) => current || messageText)
        setAttachments((current) => current.length > 0 ? current : submittedAttachments)
        return
      }

      storeTerminalAISessionId(terminalSession.id, response.session_id)
      prependSessionListItem(response)
    }

    const sent = await sendMessage(
      normalizedInput,
      terminalContextText,
      activeModel,
      permissionMode,
      terminalScope,
      toAgentImageAttachments(submittedAttachments)
    )
    if (!sent) {
      setInput((current) => current || messageText)
      setAttachments((current) => current.length > 0 ? current : submittedAttachments)
    }
  }, [
    activeModel,
    attachments,
    canSendToSession,
    input,
    isConfigLoading,
    isConfigured,
    isChatRequestActive,
    prependSessionListItem,
    permissionMode,
    sendMessage,
    session,
    startNewSession,
    terminalContextText,
    terminalScope,
    terminalSession.id,
  ])

  const toolbar = (
    <div
      className="terminal-ai-glass-toolbar relative z-[1] flex min-h-10 shrink-0 items-center justify-between gap-3 px-3 text-foreground"
    >
      <div className="min-w-0">
        <span className="truncate text-sm font-medium">{tAI("terminalPanelTitle")}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={tAI("sidebarTitle")}
              title={tAI("sidebarTitle")}
            >
              <History className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="terminal-ai-glass-popover w-[330px] overflow-hidden rounded-lg p-0 text-popover-foreground"
          >
            <div className="border-b border-border/60 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={sessionSearch}
                  onChange={(event) => setSessionSearch(event.target.value)}
                  placeholder={tAI("searchPlaceholder")}
                  className="h-8 border-transparent bg-muted/50 pl-8 pr-8 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {sessionSearch && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={() => setSessionSearch("")}
                    aria-label={tAI("cancel")}
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
                    <span>{tAI("loading")}</span>
                  </div>
                ) : sessionListError ? (
                  <div className="px-3 py-10 text-center text-sm text-destructive">
                    {sessionListError}
                  </div>
                ) : sessionList.length === 0 ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {tAI("sessionListEmpty")}
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
                              ? "bg-accent text-foreground"
                              : "text-foreground hover:bg-accent"
                          )}
                          onClick={() => void handleRestoreSession(item.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (isRenaming) return
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
                                    aria-label={tAI("saveSessionTitle")}
                                    title={tAI("saveSessionTitle")}
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
                                    aria-label={tAI("cancel")}
                                    title={tAI("cancel")}
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="truncate text-sm font-medium">{item.title}</div>
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
                                  className="size-7 rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground"
                                  disabled={Boolean(sessionActionLoadingId)}
                                  onClick={() => beginRenameSession(item)}
                                  aria-label={tAI("rename")}
                                  title={tAI("rename")}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 rounded-md text-muted-foreground hover:bg-background/80 hover:text-destructive"
                                  disabled={Boolean(sessionActionLoadingId)}
                                  onClick={() => void handleDeleteSession(item.id)}
                                  aria-label={tAI("delete")}
                                  title={tAI("delete")}
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
                            <span>{tAI("sidebarMessageCount", { count: item.message_count })}</span>
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

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={createSessionDisabled}
          onClick={() => void handleCreateNewSession()}
          aria-label={tAI("newSession")}
          title={tAI("newSession")}
        >
          {sessionCreating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SquarePen className="size-4" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label={tAI("panelHintClose")}
          title={tAI("panelHintClose")}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={tAI("panelAriaPanelLabel")}
      className={cn(
        "terminal-ai-glass absolute inset-0 z-40 flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden text-foreground",
        "md:relative md:inset-auto md:translate-x-0",
        isResizing ? "transition-none" : "transition-[transform,width,max-width] duration-150 ease-out",
        isOpen
          ? "translate-x-0 md:w-[var(--terminal-ai-panel-width)] md:max-w-[55vw]"
          : "translate-x-full md:w-0 md:max-w-[0px]"
      )}
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        "--terminal-ai-panel-width": `${panelWidth}px`,
      } as CSSProperties}
    >
      {confirmDialog}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 md:hidden"
        style={{ backgroundColor: background.color }}
      />
      {background.image && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat md:hidden"
          style={{
            backgroundImage: `url(${background.image})`,
            opacity: background.imageOpacity,
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="terminal-ai-glass-surface pointer-events-none absolute inset-0 z-0"
      />
      {toolbar}
      <div
        className={cn(
          "relative z-[1] flex min-h-0 w-full flex-1 flex-col overflow-hidden text-foreground shadow-2xl md:shadow-none",
          "transition-opacity duration-150 ease-out",
          isOpen
            ? "opacity-100"
            : "opacity-0"
        )}
        aria-hidden={!isOpen}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={tAI("resizePanel")}
          title={tAI("resizePanel")}
          className={cn(
            "absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1 cursor-col-resize touch-none md:block",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors",
            "hover:after:bg-primary/50",
            isResizing && "after:bg-primary"
          )}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />

        <Conversation className="z-[1] min-h-0 w-full flex-1 [&>div]:scrollbar-custom">
          <ConversationContent
            aria-label={tAI("panelAriaHistoryLabel")}
            className="min-h-full w-full px-4 py-4"
          >
            <AgentAIElementsTimeline
              messages={uiMessages}
              tText={tAI}
              onUpdateUserMessage={handleUpdateUserMessage}
              onDeleteUserMessage={handleDeleteUserMessage}
              assistantLoadingState={assistantLoadingState}
              emptyDescription={tAI("terminalEmptyDescription")}
              compact
              className="w-full"
            />
          </ConversationContent>
          <ConversationInitialScroll
            enabled={isOpenSettled && Boolean(sessionId) && uiMessages.length > 0}
            scrollKey={sessionId ? `${sessionId}:${uiMessages[0]?.id ?? ""}` : null}
          />
          <ConversationScrollButton className="terminal-ai-glass-control bottom-3 size-8" />
        </Conversation>

        <div className="relative z-[1] shrink-0 p-3">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleAttachmentSelection}
          />

          <ComposerReferenceChips
            attachments={attachments}
            onClearServers={() => undefined}
            onRemoveAttachment={(attachmentId) => setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
            onToggleServer={() => undefined}
            selectedServers={[]}
            t={tAI}
          />

          <AgentApprovalQueue
            tasks={tasks}
            messages={uiMessages}
            tText={tAI}
            onConfirmTask={confirmTask}
            compact
            className="mb-2"
          />

          <PromptInput
            onSubmit={(message) => handleSubmit(message.text)}
            className="terminal-ai-glass-composer rounded-xl"
          >
            <PromptInputTextarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPaste={handleAttachmentPaste}
              placeholder={
                isConfigLoading
                  ? tAI("checkingConfig")
                  : !isConfigured
                    ? tAI("aiNotConfiguredPlaceholder")
                    : tAI("terminalPanelInputPlaceholder")
              }
              minHeight={74}
              maxHeight={176}
              className="px-3 py-3 text-sm"
              disabled={
                isConfigLoading ||
                !isConfigured ||
                sessionCreating ||
                transport === "connecting" ||
                (Boolean(session) && !canSendToSession && session?.status !== "closed")
              }
            />

            <PromptInputToolbar className="gap-2 px-2 py-1.5">
              <PromptInputTools className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachmentsLoading || attachments.length >= MAX_COMPOSER_ATTACHMENTS || !isConfigured}
                  aria-label={tAI("attachFile")}
                  title={tAI("attachFile")}
                >
                  {attachmentsLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                </Button>
                {isConfigured ? (
                  <>
                    <PromptInputModelSelect
                      value={resolvedModel}
                      onValueChange={setModel}
                    >
                      <PromptInputModelSelectTrigger className="h-8 max-w-[150px] gap-1.5 rounded-md px-2 text-xs">
                        <Sparkles className="size-3.5 shrink-0" />
                        <PromptInputModelSelectValue />
                      </PromptInputModelSelectTrigger>
                      <PromptInputModelSelectContent>
                        {modelOptions.map((option) => (
                          <PromptInputModelSelectItem key={option} value={option}>
                            {option}
                          </PromptInputModelSelectItem>
                        ))}
                      </PromptInputModelSelectContent>
                    </PromptInputModelSelect>

                    <PromptInputModelSelect
                      value={permissionMode}
                      onValueChange={(value) => setPermissionMode(value as PermissionMode)}
                    >
                      <PromptInputModelSelectTrigger
                        className="h-8 max-w-[150px] gap-1.5 rounded-md px-2 text-xs"
                        title={activePermissionOption.description}
                      >
                        <Shield className="size-3.5 shrink-0" />
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
                  </>
                ) : isConfigLoading ? (
                  <div className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{tAI("checkingConfig")}</span>
                  </div>
                ) : adapters?.aiSettings ? (
                  <AIAssistantConfigPopover
                    open={configOpen}
                    onOpenChange={setConfigOpen}
                    customConfigOnly
                    adapter={adapters.aiSettings}
                    onSaved={() => void refetchAIConfig()}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                      >
                        <Settings2 className="size-3.5" />
                        <span>{tAI("configureAI")}</span>
                      </Button>
                    }
                  />
                ) : canUseWebSettingsFallback ? (
                  <Button
                    asChild
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                  >
                    <Link to="/dashboard/settings?tab=ai">
                      <Settings2 className="size-3.5" />
                      <span>{tAI("configureAI")}</span>
                    </Link>
                  </Button>
                ) : null}
              </PromptInputTools>

              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {tAI("sidebarMessageCount", { count: messageCount })}
                </span>

                {isAssistantActive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-md"
                    onClick={() => void cancelSession()}
                    aria-label={tAI("stopGenerating")}
                    title={tAI("stopGenerating")}
                  >
                    <Square className="size-3.5" />
                  </Button>
                ) : (
                  <PromptInputSubmit
                    disabled={!canSend}
                    className="size-8 rounded-md"
                    aria-label={tAI("send")}
                  />
                )}
              </div>
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </aside>
  )
}
