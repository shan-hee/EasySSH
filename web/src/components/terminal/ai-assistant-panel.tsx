import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo, type CSSProperties, type ChangeEvent, type ClipboardEvent, type PointerEvent } from "react"
import { Link } from "react-router-dom"
import {
  Loader2,
  Settings2,
  Shield,
  SquarePen,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { AISessionHistoryPopover } from "@/components/ai-agent/ai-session-history-popover"
import { AIAssistantConfigPopover } from "@/components/ai-agent/ai-config-popover"
import {
  ComposerContextReferences,
  ComposerAttachmentList,
  MAX_COMPOSER_ATTACHMENTS,
  buildAgentMessageContext,
  toAgentImageAttachments,
  type ComposerContextReference,
  useComposerAttachments,
} from "@/components/ai-agent/composer"
import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import { Button } from "@/components/ui/button"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { toast } from "@/components/ui/sonner"
import { AgentComposer, AgentComposerInput, AgentComposerSubmit, AgentComposerToolbar, AgentComposerTools, AgentComposerAttachButton, AgentComposerDictation } from "@/components/ai-agent/agent-composer"
import { AgentModelSelector } from "@/components/ai-agent/agent-model-selector"
import { modelSelectorTriggerVariants } from "@/components/assistant-ui/elements/model-selector"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSetAgentComposerDraft } from "@/hooks/use-agent-composer-draft"
import { useAIAssistantController } from "@/hooks/use-ai-assistant-controller"
import { useAISessionHistory } from "@/hooks/use-ai-session-history"
import {
  deleteAISession as deleteAISessionAPI,
  listAISessions as listAISessionsAPI,
  renameAISession as renameAISessionAPI,
  type AgentSessionScope,
  type PermissionMode,
} from "@/lib/api/ai-agent"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { cn } from "@/lib/utils"
import type { TerminalSession } from "./types"
import { TerminalAIContextPicker } from "./terminal-ai-context-picker"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"

const ANIMATION_DELAY = 160
const PANEL_OPEN_SETTLE_DELAY = 180
const PANEL_WIDTH_STORAGE_KEY = "easyssh:terminal-ai-assistant:panel-width"
const DEFAULT_PANEL_WIDTH = 420
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 720
const loadAgentThread = () => import("@/components/ai-agent/agent-thread").then(module => ({ default: module.AgentThread }))
const AgentThread = lazy(loadAgentThread)

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
const TERMINAL_AI_SESSION_STORAGE_LIMIT = 80

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
    delete nextMap[terminalSessionId]
    nextMap[terminalSessionId] = aiSessionId
    const staleKeys = Object.keys(nextMap).slice(0, -TERMINAL_AI_SESSION_STORAGE_LIMIT)
    staleKeys.forEach((key) => delete nextMap[key])
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
  const controller = useAIAssistantController({
    aiConfigAdapter: adapters?.aiConfig,
    aiSessionAdapter: adapters?.aiSession,
    includeAutoModel: true,
  })
  const {
    config: {
      isConfigured,
      isLoading: isConfigLoading,
      refetch: refetchAIConfig,
    },
    agentSession,
    model,
    setModel,
    modelOptions,
    activeModel,
    permissionMode,
    setPermissionMode,
    isChatRequestActive,
    isAssistantActive,
    assistantLoadingState,
  } = controller
  const {
    session,
    sessionId,
    transport,
    error,
    clearError,
    canSend: canSendToSession,
    restoreSession,
    startNewSession,
    sendMessage,
    updateMessage: updateUserMessage,
    regenerateMessage,
    deleteMessage: deleteUserMessage,
    cancelSession,
    continueRun,
    detachSession,
    discardSessionIfEmpty,
  } = agentSession
  const listSessions = adapters?.listAISessions ?? listAISessionsAPI
  const renameSession = adapters?.renameAISession ?? renameAISessionAPI
  const deleteSession = adapters?.deleteAISession ?? deleteAISessionAPI

  const setInput = useSetAgentComposerDraft(agentSession.runtime)
  const attachmentLimitNotice = useCallback(() => {
    toast.info(tAI("attachmentLimitHint", { count: MAX_COMPOSER_ATTACHMENTS }))
  }, [tAI])
  const attachmentRejectedNotice = useCallback((file: File, reason: "total-size" | "read") => {
    toast.error(reason === "total-size"
      ? tAI("attachmentTotalSizeHint")
      : tAI("attachmentReadFailed", { file: file.name }))
  }, [tAI])
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
  const [contextReferences, setContextReferences] = useState<ComposerContextReference[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [sessionCreating, setSessionCreating] = useState(false)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [isOpenSettled, setIsOpenSettled] = useState(false)
  const [hasMountedThread, setHasMountedThread] = useState(false)

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
  const history = useAISessionHistory({
    enabled: isConfigured && !isConfigLoading,
    listSessions,
    renameSession,
    deleteSession,
    scope: terminalScope,
    loadErrorMessage: tAI("sessionListLoadFailed"),
    renameErrorMessage: tAI("renameSessionFailed"),
    deleteErrorMessage: tAI("deleteSessionFailed"),
  })
  const {
    actionLoadingId: historyActionLoadingId,
    forget: forgetHistorySession,
    prepend: prependHistorySession,
    remove: removeHistorySession,
    renamingId: historyRenamingId,
    setOpen: setHistoryOpen,
    syncSession: syncHistorySession,
    findEmptySession: findEmptyHistorySession,
  } = history

  useEffect(() => {
    if (session?.id) {
      syncHistorySession(session, tAI("newSession"))
    }
  }, [session, syncHistorySession, tAI])

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
  const composerContextText = useMemo(() => buildAgentMessageContext({
    attachments,
    selectedServers: [],
    references: contextReferences,
    t: tAI,
  }), [attachments, contextReferences, tAI])
  const outboundContextText = useMemo(
    () => [terminalContextText, composerContextText].filter(Boolean).join("\n\n"),
    [composerContextText, terminalContextText]
  )

  const resolvedModel = model || "auto"
  const canSend =
    isConfigured &&
    !isConfigLoading &&
    !sessionCreating && !attachmentsLoading &&
    !isChatRequestActive &&
    (canSendToSession || (!session && transport === "idle") || session?.status === "closed")
  const createSessionDisabled = !isConfigured || isConfigLoading || sessionCreating
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
        setHasMountedThread(true)
      }, PANEL_OPEN_SETTLE_DELAY)
    })

    void loadAgentThread().catch(error => console.error('Failed to preload AI thread:', error))

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [isOpen, setHistoryOpen])

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

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const handleCreateNewSession = useCallback(async () => {
    if (createSessionDisabled || sessionCreatingRef.current) return
    sessionCreatingRef.current = true
    setSessionCreating(true)

    try {
      if (isAssistantActive) {
        const confirmed = await requestConfirm({
          description: tAI("replaceRunningSessionConfirm"),
          variant: "destructive",
        })
        if (!confirmed) return
      }
      const response = await startNewSession({
        model: activeModel,
        permissionMode,
        scope: terminalScope,
        findEmptySession: () => findEmptyHistorySession(terminalScope),
      })

      if (response) {
        setInput("")
        clearAttachments()
        setContextReferences([])
        storeTerminalAISessionId(terminalSession.id, response.session_id)
        setHistoryOpen(false)
        focusComposer()
      }
    } finally {
      sessionCreatingRef.current = false
      setSessionCreating(false)
    }
  }, [
    activeModel,
    clearAttachments,
    createSessionDisabled,
    focusComposer,
    findEmptyHistorySession,
    permissionMode,
    requestConfirm,
    setHistoryOpen,
    setInput,
    isAssistantActive,
    startNewSession,
    terminalScope,
    terminalSession.id,
    tAI,
  ])

  const handleRestoreSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId || sessionCreatingRef.current || historyRenamingId) {
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
  }, [focusComposer, historyRenamingId, restoreSession, sessionId, setHistoryOpen, terminalSession.id])

  const handleDeleteSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId || historyActionLoadingId) {
      return
    }

    const confirmed = await requestConfirm({
      description: tAI("deleteSessionConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    const removed = await removeHistorySession(targetSessionId)
    if (removed) {
      removeStoredTerminalAISessionId(terminalSession.id, targetSessionId)
      if (targetSessionId === sessionId) {
        detachSession()
      }
    }
  }, [
    detachSession,
    historyActionLoadingId,
    removeHistorySession,
    requestConfirm,
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

  const handleRegenerateUserMessage = useCallback(async (messageId: string) => {
    const messages = session?.messages ?? []
    const index = messages.findIndex((message) => message.id === messageId)
    if (index >= 0 && messages.slice(index + 1).some((message) => message.role === "user")) {
      const confirmed = await requestConfirm({ description: tAI("regenerateMessageConfirm"), variant: "destructive" })
      if (!confirmed) return false
    }
    return regenerateMessage(messageId, {
      contextText: terminalContextText,
      model: activeModel,
      permissionMode,
      scope: terminalScope,
    })
  }, [activeModel, permissionMode, terminalContextText, terminalScope, regenerateMessage, requestConfirm, session?.messages, tAI])

  const handleDeleteUserMessage = useCallback(async (messageId: string) => {
    const stopped = session?.messages.some((message) => message.id === messageId && !!message.stopped_at)
    const confirmed = await requestConfirm({
      description: tAI(stopped ? "auiDiscardRunConfirm" : "deleteMessageConfirm"),
      variant: "destructive",
    })
    if (!confirmed) {
      return false
    }

    return deleteUserMessage(messageId)
  }, [deleteUserMessage, requestConfirm, session?.messages, tAI])

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

  const handleSubmit = useCallback(async (messageText: string) => {
    const normalizedInput = messageText.trim()
    if ((!normalizedInput && attachments.length === 0 && contextReferences.length === 0) || !isConfigured || isConfigLoading || sessionCreatingRef.current) {
      return
    }

    if (isChatRequestActive || (session && session.status !== "closed" && !canSendToSession)) {
      return
    }

    const submittedAttachments = detachAttachments()
    const submittedReferences = contextReferences
    setInput("")
    setContextReferences([])
    let createdSessionId: string | null = null

    if (!session || session.status === "closed") {
      sessionCreatingRef.current = true
      setSessionCreating(true)

      const response = await (async () => {
        try {
          return await startNewSession({
            model: activeModel,
            permissionMode,
            scope: terminalScope,
          })
        } finally {
          sessionCreatingRef.current = false
          setSessionCreating(false)
        }
      })()

      if (!response) {
        setInput((current) => current || messageText)
        restoreAttachments(submittedAttachments)
        setContextReferences(submittedReferences)
        return
      }

      storeTerminalAISessionId(terminalSession.id, response.session_id)
      createdSessionId = response.session_id
      prependHistorySession(response, tAI("newSession"))
    }

    let imageAttachments
    try {
      imageAttachments = await toAgentImageAttachments(submittedAttachments)
    } catch {
      if (createdSessionId && await discardSessionIfEmpty(createdSessionId)) {
        forgetHistorySession(createdSessionId)
        removeStoredTerminalAISessionId(terminalSession.id, createdSessionId)
      }
      setInput((current) => current || messageText)
      restoreAttachments(submittedAttachments)
      setContextReferences(submittedReferences)
      toast.error(tAI("attachmentReadFailed"))
      return
    }

    const sendResult = await sendMessage(
      normalizedInput || tAI("contextOnlyPrompt"),
      outboundContextText,
      activeModel,
      permissionMode,
      terminalScope,
      imageAttachments
    )
    if (sendResult === "failed") {
      if (createdSessionId && await discardSessionIfEmpty(createdSessionId)) {
        forgetHistorySession(createdSessionId)
        removeStoredTerminalAISessionId(terminalSession.id, createdSessionId)
      }
      setInput((current) => current || messageText)
      restoreAttachments(submittedAttachments)
      setContextReferences(submittedReferences)
    } else {
      releaseAttachments(submittedAttachments)
    }
  }, [
    activeModel,
    attachments,
    canSendToSession,
    contextReferences,
    detachAttachments,
    discardSessionIfEmpty,
    forgetHistorySession,
    isConfigLoading,
    isConfigured,
    isChatRequestActive,
    prependHistorySession,
    outboundContextText,
    permissionMode,
    releaseAttachments,
    restoreAttachments,
    sendMessage,
    session,
    setInput,
    startNewSession,
    terminalScope,
    terminalSession.id,
    tAI,
  ])
  const handleContinueStoppedRun = useCallback((id: string) => (
    continueRun(id, tAI("auiContinuePrompt"), { contextText: terminalContextText, model: activeModel, permissionMode })
  ), [continueRun, tAI, terminalContextText, activeModel, permissionMode])

  const toolbar = (
    <div className="terminal-ai-glass-toolbar relative z-[1] flex min-h-10 shrink-0 items-center justify-between gap-3 px-3 text-foreground">
      <div className="min-w-0">
        <span className="truncate text-sm font-medium">{tAI("terminalPanelTitle")}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <AISessionHistoryPopover
          activeSessionId={sessionId}
          history={history}
          onDelete={handleDeleteSession}
          onRestore={handleRestoreSession}
          t={tAI}
          triggerClassName="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          className="terminal-ai-glass-popover text-popover-foreground"
        />

        <TooltipIconButton
          type="button"
          className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={createSessionDisabled}
          onClick={() => void handleCreateNewSession()}
          tooltip={tAI("newSession")}
        >
          {sessionCreating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SquarePen className="size-4" />
          )}
        </TooltipIconButton>

        <TooltipIconButton
          type="button"
          className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          tooltip={tAI("panelHintClose")}
        >
          <X className="size-4" />
        </TooltipIconButton>
      </div>
    </div>
  )

  return (
    <AssistantRuntimeProvider runtime={agentSession.runtime}>
    <aside
      ref={panelRef}
      data-terminal-panel
      role="complementary"
      aria-label={tAI("panelAriaPanelLabel")}
      className={cn(
        "terminal-ai-glass absolute inset-0 z-40 flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden text-foreground",
        "md:relative md:inset-auto md:translate-x-0",
        isResizing ? "transition-none" : "transition-[transform,width,max-width] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        isOpen
          ? "translate-x-0 md:w-[var(--terminal-ai-panel-width)] md:max-w-[55vw]"
          : "translate-x-full md:w-0 md:max-w-[0px]"
      )}
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        "--terminal-ai-panel-width": `${panelWidth}px`,
      } as CSSProperties}
      inert={!isOpen}
      aria-hidden={!isOpen}
    >
      <div className="relative flex h-full min-h-0 w-full shrink-0 flex-col md:w-[min(var(--terminal-ai-panel-width),55vw)]">
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

        <Suspense fallback={<div className="min-h-0 flex-1" aria-busy="true" />}>
        {hasMountedThread ? <AgentThread
          key={sessionId ?? "new"}
          tText={tAI}
          scope={session?.scope}
          onUpdateUserMessage={handleUpdateUserMessage}
          onRegenerateUserMessage={handleRegenerateUserMessage}
          onContinueStoppedRun={handleContinueStoppedRun}
          onDeleteUserMessage={handleDeleteUserMessage}
          assistantLoadingState={assistantLoadingState}
          emptyDescription={tAI("terminalEmptyDescription")}
          compact
          className="z-[1] min-h-0 w-full flex-1"
        /> : <div className="min-h-0 flex-1" aria-busy="true" />}
        </Suspense>

        <div className="relative z-[1] shrink-0 p-3">
          {agentSession.reconnecting && (
            <div role="status" className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <Loader2 className="size-3 shrink-0 animate-spin" />
              {tAI("auiReconnecting")}
            </div>
          )}
          {error && (
            <ErrorState detail={error} className="mb-2 px-3 py-2" action={
              <TooltipIconButton type="button" className="-my-1 size-6 shrink-0" onClick={clearError} tooltip={tAI("cancel")}>
                <X className="size-3" />
              </TooltipIconButton>
            } />
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,text/*,.json,.yaml,.yml,.xml,.csv,.md,.log,.sh,.py,.js,.ts,.tsx,.go,.rs,.java,.sql"
            className="hidden"
            onChange={handleAttachmentSelection}
          />

          <AgentComposer
            onSubmit={(text) => handleSubmit(text)}
            className="terminal-ai-glass-composer"
          >
            <ComposerAttachmentList
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              t={tAI}
            />

          <ComposerContextReferences
            references={contextReferences}
            onRemove={(referenceId) => setContextReferences((current) => current.filter((reference) => reference.id !== referenceId))}
          />
            <AgentComposerInput
              runtime={agentSession.runtime}
              ref={inputRef}
              onPaste={handleAttachmentPaste}
              placeholder={
                isConfigLoading
                  ? tAI("checkingConfig")
                  : !isConfigured
                    ? tAI("aiNotConfiguredPlaceholder")
                    : tAI("terminalPanelInputPlaceholder")
              }
              disabled={
                isConfigLoading ||
                !isConfigured ||
                sessionCreating ||
                transport === "connecting" ||
                (Boolean(session) && !canSendToSession && session?.status !== "closed")
              }
            />

            <AgentComposerToolbar className="gap-2">
              <AgentComposerTools className="flex flex-wrap items-center gap-1.5">
                <AgentComposerAttachButton onClick={() => fileInputRef.current?.click()} disabled={attachmentsLoading || attachments.length >= MAX_COMPOSER_ATTACHMENTS || !isConfigured} aria-busy={attachmentsLoading} title={tAI("attachFile")} />
                <TerminalAIContextPicker
                  session={terminalSession}
                  disabled={!isConfigured || isConfigLoading}
                  onAdd={(reference) => setContextReferences((current) => [
                    ...current.filter((item) => item.kind !== reference.kind),
                    reference,
                  ])}
                />
                {isConfigured ? (
                  <>
                    <AgentModelSelector models={modelOptions} value={resolvedModel} onValueChange={setModel} />

                    <Select
                      value={permissionMode}
                      onValueChange={(value) => setPermissionMode(value as PermissionMode)}
                    >
                      <SelectTrigger
                        size="sm"
                        className={cn(modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }), "max-w-[150px] rounded-full text-muted-foreground")}
                        title={permissionOptions.find((option) => option.value === permissionMode)?.description}
                      >
                        <Shield className="size-3.5 shrink-0" />
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
              </AgentComposerTools>

              <div className="ml-auto flex items-center gap-2">
                <AgentComposerDictation disabled={isConfigLoading || !isConfigured || isAssistantActive} />
                <AgentComposerSubmit running={isAssistantActive} disabled={!canSend} hasContent={attachments.length > 0 || contextReferences.length > 0} onCancel={cancelSession} />
              </div>
            </AgentComposerToolbar>
          </AgentComposer>
        </div>
      </div>
      </div>
    </aside>
    </AssistantRuntimeProvider>
  )
}
