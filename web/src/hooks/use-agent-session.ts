import { WebSpeechDictationAdapter, WebSpeechSynthesisAdapter } from "@assistant-ui/react"
import { useTranslation } from "react-i18next"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat, type UIMessage, type UseChatHelpers } from "@ai-sdk/react"
import { useAISDKRuntime } from "@assistant-ui/ai-sdk"
import { DefaultChatTransport, isToolUIPart } from "ai"
import {
  cancelAISession,
  createAISession,
  deleteAISession,
  deleteAIMessage,
  getAISession,
  getLatestAISession,
  updateAIMessage,
  type AgentSessionScope,
  type AgentImageAttachment,
  type CreateSessionResponse,
  type MessageView,
  type PermissionMode,
  type SessionView,
  type TaskView,
  type ToolView,
} from "@/lib/api/ai-agent"
import { getApiUrl } from "@/lib/api-client"
import { useAgentFeedback } from "@/hooks/use-agent-feedback"
import { isSessionView, useAISessionRecovery } from "@/hooks/use-ai-session-recovery"
import { fetchAIChatStream, isRecoverableAIStreamError } from "@/lib/ai-agent/stream-transport"
import { resolveOutgoingUserMessageId } from "@/lib/ai-agent/message-transport"

type TransportState = "idle" | "connecting" | "ai_sdk_ui"
const TARGET_SESSION_ID_BODY_KEY = "__easyssh_target_session_id"

export interface AgentSessionAdapter {
  getSession: (sessionId: string) => Promise<CreateSessionResponse>
  getLatestSession: (scope?: AgentSessionScope) => Promise<CreateSessionResponse | null>
  createSession: (input: {
    model?: string
    permission_mode?: PermissionMode
    scope?: AgentSessionScope
  }) => Promise<CreateSessionResponse>
  sendMessage: (input: {
    session_id: string
    content: string
    context?: string
    model?: string
    permission_mode?: PermissionMode
    scope?: AgentSessionScope
    attachments?: AgentImageAttachment[]
  }) => Promise<CreateSessionResponse>
  updateMessage: (input: {
    session_id: string
    message_id: string
    content: string
  }) => Promise<CreateSessionResponse>
  regenerateMessage: (input: {
    session_id: string
    message_id: string
    context?: string
    model?: string
    permission_mode?: PermissionMode
    scope?: AgentSessionScope
  }) => Promise<CreateSessionResponse>
  deleteMessage: (input: {
    session_id: string
    message_id: string
  }) => Promise<CreateSessionResponse>
  subscribeSessionEvents: (callback: (event: {
    session_id?: string
    type?: string
    session?: SessionView
    ui_message?: UIMessage
    error?: string
  }) => void) => () => void
  respondToToolApproval: (input: {
    session_id: string
    id: string
    approved: boolean
    reason?: string
  }) => Promise<CreateSessionResponse>
  cancelSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function compareTaskExecutionOrder(left: TaskView, right: TaskView) {
  return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
}

function getSessionChatApi(sessionId?: string | null) {
  return getApiUrl(`/ai/sessions/${sessionId?.trim() || "__idle__"}/chat`)
}

function getSessionMessagesSyncKey(session: SessionView) {
  const messages = session.ui_messages ?? []
  const lastMessage = messages.at(-1)
  const lastTextLength = lastMessage ? getUIMessageTextLength(lastMessage) : 0
  const lastPart = lastMessage?.parts.at(-1) as { state?: unknown; toolCallId?: unknown } | undefined

  return [
    session.id,
    session.updated_at,
    messages.length,
    lastMessage?.id ?? "",
    lastMessage?.parts.length ?? 0,
    lastTextLength,
    typeof lastPart?.state === "string" ? lastPart.state : "",
    typeof lastPart?.toolCallId === "string" ? lastPart.toolCallId : "",
  ].join(":")
}

function getSessionScopeKey(scope?: AgentSessionScope) {
  return [
    scope?.kind ?? "global",
    scope?.terminal_session_id?.trim() ?? "",
    scope?.server_id?.trim() ?? "",
  ].join(":")
}

function isReusableEmptySession(session: SessionView, scope?: AgentSessionScope) {
  return session.status === "idle"
    && session.messages.length === 0
    && session.ui_messages.length === 0
    && session.tasks.length === 0
    && getSessionScopeKey(session.scope) === getSessionScopeKey(scope)
}

function mergeUIMessage(messages: UIMessage[], nextMessage: UIMessage) {
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...messages, nextMessage]
  }

  const existingMessage = messages[existingIndex]
  if (isStreamingUIMessage(nextMessage) && !isStreamingUIMessage(existingMessage)) {
    return messages
  }
  if (isStreamingUIMessage(nextMessage) && getUIMessageTextLength(nextMessage) < getUIMessageTextLength(existingMessage)) {
    return messages
  }

  const nextMessages = [...messages]
  nextMessages[existingIndex] = nextMessage
  return nextMessages
}

function isStreamingUIMessage(message: UIMessage) {
  if (message.metadata && typeof message.metadata === "object" && "pending" in message.metadata) {
    return Boolean((message.metadata as { pending?: unknown }).pending)
  }

  return message.parts.some((part) => (
    "state" in part && (part as { state?: unknown }).state === "streaming"
  ))
}

function getUIMessageTextLength(message: UIMessage) {
  return message.parts.reduce((length, part) => {
    if ("text" in part && typeof part.text === "string") {
      return length + part.text.length
    }
    return length
  }, 0)
}

function createOptimisticUserUIMessage(
  id: string,
  content: string,
  attachments: AgentImageAttachment[],
): UIMessage {
  return {
    id,
    role: "user",
    metadata: { createdAt: new Date().toISOString() },
    parts: [
      ...attachments.map((attachment) => ({
        type: "file" as const,
        filename: attachment.name,
        mediaType: attachment.media_type,
        url: `data:${attachment.media_type};base64,${attachment.data}`,
      })),
      ...(content ? [{ type: "text" as const, text: content }] : []),
    ],
  }
}

function createOptimisticUserMessage(
  id: string,
  content: string,
  createdAt: string,
): MessageView {
  return {
    id,
    role: "user",
    content,
    created_at: createdAt,
  }
}

export function useAgentSession(adapter?: AgentSessionAdapter) {
  const { i18n } = useTranslation()
  const dictation = useMemo(() => WebSpeechDictationAdapter.isSupported()
    ? new WebSpeechDictationAdapter({ language: i18n.resolvedLanguage || i18n.language })
    : undefined, [i18n.language, i18n.resolvedLanguage])
  const [session, setSession] = useState<SessionView | null>(null)
  const [transport, setTransport] = useState<TransportState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [needsRecovery, setNeedsRecovery] = useState(false)
  const [recoveryBlocked, setRecoveryBlocked] = useState(false)

  const sessionRef = useRef<SessionView | null>(null)
  const lastRestoreKeyRef = useRef<string | null>(null)
  const closingSessionIdRef = useRef<string | null>(null)
  const syncedMessagesKeyRef = useRef<string | null>(null)
  const idleChatIdRef = useRef(createLocalId("agent-chat"))
  const approvalSubmissionRef = useRef(false)
  const chatErrorRef = useRef<Error | null>(null)
  const sessionRevisionRef = useRef(0)
  const snapshotRevisionRef = useRef(0)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const sessionId = session?.id ?? null
  const chatId = idleChatIdRef.current

  const chatTransport = useMemo(
    () => new DefaultChatTransport<UIMessage>({
      api: getSessionChatApi(null),
      fetch: fetchAIChatStream,
      prepareReconnectToStreamRequest: ({ id }) => ({ api: `${getSessionChatApi(id)}/stream` }),
      prepareSendMessagesRequest(options) {
        const body = options.body ?? {}
        const targetSessionIdValue = body[TARGET_SESSION_ID_BODY_KEY]
        const targetSessionId = typeof targetSessionIdValue === "string"
          ? targetSessionIdValue.trim()
          : ""
        const requestBody = { ...body }
        delete requestBody[TARGET_SESSION_ID_BODY_KEY]
        const latestMessage = options.messages.at(-1)
        const requestMessages = latestMessage
          ? [{
              ...latestMessage,
              parts: latestMessage.parts.filter((part) => part.type !== "file"),
            }]
          : []

        return {
          api: targetSessionId ? getSessionChatApi(targetSessionId) : options.api,
          headers: options.headers,
          credentials: options.credentials,
          body: {
            ...requestBody,
            id: options.id,
            messages: requestMessages,
            trigger: options.trigger,
            messageId: resolveOutgoingUserMessageId(latestMessage, options.messageId),
          },
        }
      },
    }),
    []
  )

  const commitSessionSnapshot = useCallback((
    nextSession: SessionView,
    input: { syncMessages?: boolean } = {},
  ) => {
    closingSessionIdRef.current = null
    snapshotRevisionRef.current++
    sessionRef.current = nextSession
    setSession(nextSession)
    setTransport("ai_sdk_ui")
    syncedMessagesKeyRef.current = input.syncMessages === false
      ? getSessionMessagesSyncKey(nextSession)
      : null
  }, [])

  const refreshSessionSnapshot = useCallback(async (
    targetSessionId = sessionRef.current?.id,
    input: { syncMessages?: boolean } = {}
  ) => {
    if (!targetSessionId || closingSessionIdRef.current === targetSessionId) {
      return null
    }

    const revision = sessionRevisionRef.current
    const snapshotRevision = snapshotRevisionRef.current
    try {
      const response = adapter
        ? await adapter.getSession(targetSessionId)
        : await getAISession(targetSessionId)
      if (closingSessionIdRef.current === targetSessionId || sessionRef.current?.id !== targetSessionId || revision !== sessionRevisionRef.current) {
        return null
      }
      // A reconnect may already have delivered a newer snapshot while this GET
      // was in flight. Never replace it with an older response.
      if (snapshotRevision !== snapshotRevisionRef.current) return sessionRef.current
      commitSessionSnapshot(response.session, input)
      if (!adapter) setNeedsRecovery(response.session.status === "running")
      return response.session
    } catch (refreshError) {
      const message = toErrorMessage(refreshError)
      if (sessionRef.current?.id === targetSessionId && revision === sessionRevisionRef.current && snapshotRevision === snapshotRevisionRef.current) {
        if (!adapter && sessionRef.current.status === "running") setNeedsRecovery(true)
        else setError(message)
      }
      return null
    }
  }, [adapter, commitSessionSnapshot])

  const chat = useChat<UIMessage>({
    id: chatId,
    messages: [],
    transport: chatTransport,
    onError(chatError) {
      chatErrorRef.current = chatError
      if (isRecoverableAIStreamError(chatError)) {
        setNeedsRecovery(true)
      } else {
        setRecoveryBlocked(true)
        setError(chatError.message)
      }
      setTransport(sessionRef.current ? "ai_sdk_ui" : "idle")
    },
    onData(dataPart) {
      if (dataPart.type === "data-session" && isSessionView(dataPart.data) && dataPart.data.id === sessionRef.current?.id) {
        commitSessionSnapshot(dataPart.data, { syncMessages: false })
      }
    },
    onFinish({ isAbort, isError }) {
      if (isAbort || (isError && isRecoverableAIStreamError(chatErrorRef.current))) return
      if (!approvalSubmissionRef.current) void refreshSessionSnapshot()
    },
  })
  const setChatMessages = chat.setMessages

  const { reconnecting, stopRecovery } = useAISessionRecovery({
    sessionId,
    revision: sessionRevisionRef.current,
    enabled: !adapter && transport !== "connecting" && !recoveryBlocked && needsRecovery
      && chat.status !== "submitted" && chat.status !== "streaming",
    transport: chatTransport,
    onSnapshot(nextSession) {
      if (sessionRef.current?.id !== nextSession.id) return
      // The recovery stream contains authoritative snapshots, not append-only deltas.
      // Update messages directly; the SDK's interrupted stream is no longer writing.
      commitSessionSnapshot(nextSession, { syncMessages: false })
      setChatMessages(nextSession.ui_messages)
      chat.clearError()
      chatErrorRef.current = null
      setNeedsRecovery(nextSession.status === "running")
      setError(null)
    },
    onError(message) {
      setRecoveryBlocked(true)
      setNeedsRecovery(false)
      setError(message)
    },
  })

  const resetRecovery = useCallback(() => {
    stopRecovery()
    setNeedsRecovery(false)
    setRecoveryBlocked(false)
    chatErrorRef.current = null
  }, [stopRecovery])

  useEffect(() => {
    if (!session?.id) {
      syncedMessagesKeyRef.current = null
      return
    }

    const syncKey = getSessionMessagesSyncKey(session)
    if (syncedMessagesKeyRef.current === syncKey) {
      return
    }

    setChatMessages(session.ui_messages || [])
    syncedMessagesKeyRef.current = syncKey
  }, [session, setChatMessages])

  useEffect(() => {
    if (!adapter) {
      return
    }

    return adapter.subscribeSessionEvents((event) => {
      const activeSession = sessionRef.current
      if (!activeSession || event.session_id !== activeSession.id || closingSessionIdRef.current === activeSession.id) {
        return
      }

      if (event.error) {
        setError(event.error)
      }

      if (event.session) {
        sessionRef.current = event.session
        setSession(event.session)
        setChatMessages((current) => {
          const snapshotMessages = event.session?.ui_messages || []
          return snapshotMessages.length >= current.length ? snapshotMessages : current
        })
        syncedMessagesKeyRef.current = getSessionMessagesSyncKey(event.session)
        setTransport("ai_sdk_ui")
        return
      }

      if (event.ui_message) {
        setChatMessages((current) => mergeUIMessage(current, event.ui_message as UIMessage))
        setTransport("ai_sdk_ui")
      }
    })
  }, [adapter, setChatMessages])

  const pushLocalError = useCallback((message: string) => {
    setError(message)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    chat.clearError()
  }, [chat])

  const applySessionResponse = useCallback((
    response: CreateSessionResponse,
    input: { syncMessages?: boolean } = {}
  ) => {
    setError(null)
    commitSessionSnapshot(response.session, input)
    if (!adapter) setNeedsRecovery(response.session.status === "running")
    return response
  }, [adapter, commitSessionSnapshot])

  const restoreLatestSession = useCallback(async (scope?: AgentSessionScope) => {
    const restoreKey = getSessionScopeKey(scope)
    if (lastRestoreKeyRef.current === restoreKey || sessionRef.current || transport !== "idle") {
      return false
    }

    lastRestoreKeyRef.current = restoreKey
    setTransport("connecting")

    try {
      const response = adapter
        ? await adapter.getLatestSession(scope)
        : await getLatestAISession(scope)
      if (!response) {
        setTransport("idle")
        return false
      }

      applySessionResponse(response)
      return true
    } catch (restoreError) {
      setTransport("idle")
      const message = toErrorMessage(restoreError)
      pushLocalError(message)
      return false
    }
  }, [adapter, applySessionResponse, pushLocalError, transport])

  const restoreSession = useCallback(async (targetSessionId: string, input: { silent?: boolean } = {}) => {
    if (!targetSessionId) {
      return false
    }

    resetRecovery()
    sessionRevisionRef.current++
    setTransport("connecting")

    try {
      if (!adapter) {
        await chat.stop()
        chat.clearError()
      }
      const response = adapter
        ? await adapter.getSession(targetSessionId)
        : await getAISession(targetSessionId)
      applySessionResponse(response)
      return true
    } catch (restoreError) {
      setTransport(sessionRef.current ? "ai_sdk_ui" : "idle")
      const message = toErrorMessage(restoreError)
      if (!input.silent) {
        pushLocalError(message)
      }
      return false
    }
  }, [adapter, applySessionResponse, chat, pushLocalError, resetRecovery])

  const startNewSession = useCallback(async (input: {
    model?: string
    permissionMode?: PermissionMode
    scope?: AgentSessionScope
    findEmptySession?: () => Promise<string | null>
  }) => {
    resetRecovery()
    sessionRevisionRef.current++
    lastRestoreKeyRef.current = getSessionScopeKey(input.scope)
    setError(null)
    setTransport("connecting")

    const currentSession = sessionRef.current
    if (!adapter) {
      await chat.stop()
      chat.clearError()
    }
    if (currentSession?.status === "running") {
      try {
        if (adapter) {
          await adapter.cancelSession(currentSession.id)
        } else {
          await cancelAISession(currentSession.id)
        }
      } catch {
        // ignore cancellation race when starting a replacement session
      }
    }

    try {
      if (input.findEmptySession) {
        if (currentSession && isReusableEmptySession(currentSession, input.scope)) {
          setTransport("ai_sdk_ui")
          return { session_id: currentSession.id, session: currentSession, default_transport: "ai_sdk_ui" } satisfies CreateSessionResponse
        }
        const emptySessionId = await input.findEmptySession()
        if (emptySessionId) {
          const existing = adapter
            ? await adapter.getSession(emptySessionId)
            : await getAISession(emptySessionId)
          // History counters can change; verify the full snapshot before reusing it.
          if (isReusableEmptySession(existing.session, input.scope)) {
            applySessionResponse(existing)
            return existing
          }
        }
      }
      const createInput = {
        model: input.model,
        permission_mode: input.permissionMode,
        scope: input.scope,
      }
      const response = adapter
        ? await adapter.createSession(createInput)
        : await createAISession(createInput)
      chat.setMessages([])
      applySessionResponse(response, { syncMessages: false })
      return response
    } catch (createError) {
      setTransport(currentSession ? "ai_sdk_ui" : "idle")
      const message = toErrorMessage(createError)
      pushLocalError(message)
      return null
    }
  }, [adapter, applySessionResponse, chat, pushLocalError, resetRecovery])

  const sendMessage = useCallback(async (
    content: string,
    contextText?: string,
    model?: string,
    permissionMode?: PermissionMode,
    scope?: AgentSessionScope,
    attachments: AgentImageAttachment[] = []
  ) => {
    const activeSessionId = sessionRef.current?.id
    const normalizedContent = content.trim()
    if (!activeSessionId || (!normalizedContent && attachments.length === 0)) {
      return "failed" as const
    }

    resetRecovery()
    sessionRevisionRef.current++
    const createdAt = new Date().toISOString()
    const outgoingMessageId = createLocalId("user")
    const optimisticUIMessage = createOptimisticUserUIMessage(
      outgoingMessageId,
      normalizedContent,
      attachments,
    )
    const activeSession = sessionRef.current
    if (!activeSession) {
      return "failed" as const
    }
    const previousMessageCount = activeSession.messages.length
    const optimisticSession: SessionView = {
      ...activeSession,
      model: model || activeSession.model,
      permission_mode: permissionMode || activeSession.permission_mode,
      scope: scope || activeSession.scope,
      status: "running",
      updated_at: createdAt,
      messages: [
        ...activeSession.messages.filter((message) => message.id !== outgoingMessageId),
        createOptimisticUserMessage(outgoingMessageId, normalizedContent, createdAt),
      ],
      ui_messages: adapter
        ? mergeUIMessage(activeSession.ui_messages, optimisticUIMessage)
        : activeSession.ui_messages,
    }

    setError(null)
    commitSessionSnapshot(optimisticSession, { syncMessages: false })
    if (adapter) {
      setChatMessages((current) => mergeUIMessage(current, optimisticUIMessage))
    }

    try {
      if (adapter) {
        const response = await adapter.sendMessage({
          session_id: activeSessionId,
          content: normalizedContent,
          context: contextText,
          model,
          permission_mode: permissionMode,
          scope,
          attachments,
        })
        applySessionResponse(response)
        return "sent" as const
      }

      await chat.sendMessage(optimisticUIMessage, {
        body: {
          [TARGET_SESSION_ID_BODY_KEY]: activeSessionId,
          context: contextText,
          model,
          permission_mode: permissionMode,
          scope,
          attachments,
        },
      })
      if (chatErrorRef.current) {
        if (isRecoverableAIStreamError(chatErrorRef.current)) return "accepted" as const
        throw chatErrorRef.current
      }
      return "sent" as const
    } catch (sendError) {
      const message = toErrorMessage(sendError)
      pushLocalError(message)
      const refreshed = await refreshSessionSnapshot(activeSessionId)
      const accepted = Boolean(refreshed && (
        refreshed.messages.some((item) => item.id === outgoingMessageId)
        || refreshed.messages.length > previousMessageCount
      ))
      return accepted ? "accepted" as const : "failed" as const
    }
  }, [adapter, applySessionResponse, chat, commitSessionSnapshot, pushLocalError, refreshSessionSnapshot, resetRecovery, setChatMessages])

  const regenerateAfterUpdate = useCallback(async (
    activeSessionId: string,
    messageId: string,
    content: string,
    input: {
      contextText?: string
      model?: string
      permissionMode?: PermissionMode
      scope?: AgentSessionScope
    } = {}
  ) => {
    resetRecovery()
    sessionRevisionRef.current++
    setError(null)
    setSession((current) => current
      ? { ...current, status: "running", updated_at: new Date().toISOString() }
      : current
    )
    setTransport("ai_sdk_ui")

    try {
      if (adapter) {
        const response = await adapter.regenerateMessage({
          session_id: activeSessionId,
          message_id: messageId,
          context: input.contextText,
          model: input.model,
          permission_mode: input.permissionMode,
          scope: input.scope,
        })
        applySessionResponse(response)
        return true
      }

      await chat.sendMessage({ text: content, messageId }, {
        body: {
          [TARGET_SESSION_ID_BODY_KEY]: activeSessionId,
          mode: "regenerate",
          context: input.contextText,
          model: input.model,
          permission_mode: input.permissionMode,
          scope: input.scope,
        },
      })
      if (chatErrorRef.current && !isRecoverableAIStreamError(chatErrorRef.current)) throw chatErrorRef.current
      return true
    } catch (regenerateError) {
      const message = toErrorMessage(regenerateError)
      pushLocalError(message)
      void refreshSessionSnapshot(activeSessionId)
      return false
    }
  }, [adapter, applySessionResponse, chat, pushLocalError, refreshSessionSnapshot, resetRecovery])

  const continuationRef = useRef(false)
  const continueRun = useCallback(async (messageId: string, prompt: string, input: {
    contextText?: string
    model?: string
    permissionMode?: PermissionMode
  } = {}) => {
    const current = sessionRef.current
    const index = current?.messages.findIndex(message => message.id === messageId && !!message.stopped_at) ?? -1
    if (!current || index < 0 || current.status !== "idle" || continuationRef.current || chat.status === "submitted" || chat.status === "streaming" || current.messages.slice(index + 1).some(message => message.role === "user")) return false
    continuationRef.current = true
    try {
      return await sendMessage(prompt, input.contextText, input.model, input.permissionMode, current.scope) !== "failed"
    } finally { continuationRef.current = false }
  }, [chat.status, sendMessage])

  const regenerationRef = useRef(false)
  const regenerateMessage = useCallback(async (
    messageId: string,
    input: { contextText?: string; model?: string; permissionMode?: PermissionMode; scope?: AgentSessionScope } = {}
  ) => {
    const current = sessionRef.current
    const message = current?.messages.find((item) => item.id === messageId && item.role === "user")
    if (!current || !message || current.status === "running" || regenerationRef.current || chat.status === "submitted" || chat.status === "streaming") return false
    regenerationRef.current = true
    try {
      return await regenerateAfterUpdate(current.id, messageId, message.content, input)
    } finally {
      regenerationRef.current = false
    }
  }, [chat.status, regenerateAfterUpdate])

  const updateMessage = useCallback(async (
    messageId: string,
    content: string,
    input: {
      regenerate?: boolean
      contextText?: string
      model?: string
      permissionMode?: PermissionMode
      scope?: AgentSessionScope
    } = {}
  ) => {
    const activeSessionId = sessionRef.current?.id
    const normalizedContent = content.trim()
    if (!activeSessionId || !messageId || !normalizedContent) {
      return false
    }

    sessionRevisionRef.current++
    setError(null)
    setTransport("ai_sdk_ui")
    try {
      const response = adapter
        ? await adapter.updateMessage({
          session_id: activeSessionId,
          message_id: messageId,
          content: normalizedContent,
        })
        : await updateAIMessage(activeSessionId, messageId, { content: normalizedContent })
      applySessionResponse(response)
      setChatMessages(response.session.ui_messages || [])
      if (input.regenerate !== false) {
        void regenerateAfterUpdate(activeSessionId, messageId, normalizedContent, input)
      }
      return true
    } catch (updateError) {
      const message = toErrorMessage(updateError)
      pushLocalError(message)
      void refreshSessionSnapshot(activeSessionId)
      return false
    }
  }, [adapter, applySessionResponse, pushLocalError, refreshSessionSnapshot, regenerateAfterUpdate, setChatMessages])

  const deleteMessage = useCallback(async (messageId: string) => {
    const activeSessionId = sessionRef.current?.id
    if (!activeSessionId || !messageId) {
      return false
    }

    sessionRevisionRef.current++
    setError(null)
    setTransport("ai_sdk_ui")
    try {
      const response = adapter
        ? await adapter.deleteMessage({
          session_id: activeSessionId,
          message_id: messageId,
        })
        : await deleteAIMessage(activeSessionId, messageId)
      applySessionResponse(response)
      return true
    } catch (deleteError) {
      const message = toErrorMessage(deleteError)
      pushLocalError(message)
      void refreshSessionSnapshot(activeSessionId)
      return false
    }
  }, [adapter, applySessionResponse, pushLocalError, refreshSessionSnapshot])

  const respondToToolApproval: UseChatHelpers<UIMessage>["addToolApprovalResponse"] = useCallback(async ({ id, approved, reason }) => {
    const activeSessionId = sessionRef.current?.id
    if (!activeSessionId || sessionRef.current?.status === "running" || needsRecovery || reconnecting || approvalSubmissionRef.current || chat.status === "submitted" || chat.status === "streaming") {
      throw new Error("当前会话暂时无法提交审批，请稍后重试")
    }
    const messages = chat.messages
    const pending = messages.some((message) => message.parts.some((part) => (
      isToolUIPart(part) && part.state === "approval-requested" && part.approval.id === id
    )))
    if (!pending) {
      throw new Error("该操作已不再等待审批")
    }
    approvalSubmissionRef.current = true
    resetRecovery()
    sessionRevisionRef.current++
    chatErrorRef.current = null
    setError(null)

    try {
      if (adapter) {
        setTransport("ai_sdk_ui")
        const response = await adapter.respondToToolApproval({
          session_id: activeSessionId,
          id,
          approved,
          reason,
        })
        if (sessionRef.current?.id === activeSessionId) applySessionResponse(response)
        return
      }

      setTransport("ai_sdk_ui")
      await chat.addToolApprovalResponse({ id, approved, reason })
      await chat.sendMessage(undefined, {
        body: {
          [TARGET_SESSION_ID_BODY_KEY]: activeSessionId,
        },
      })
      if (chatErrorRef.current) {
        if (isRecoverableAIStreamError(chatErrorRef.current)) return
        throw chatErrorRef.current
      }
      // useChat calls onError without rejecting sendMessage. Restore the server
      // snapshot before accepting another approval from the same message.
      await refreshSessionSnapshot(activeSessionId)
    } catch (confirmError) {
      if (sessionRef.current?.id === activeSessionId) {
        pushLocalError(toErrorMessage(confirmError))
        const refreshed = await refreshSessionSnapshot(activeSessionId)
        if (!refreshed && sessionRef.current?.id === activeSessionId) setChatMessages(messages)
      }
      throw confirmError
    } finally {
      approvalSubmissionRef.current = false
    }
  }, [adapter, applySessionResponse, chat, needsRecovery, pushLocalError, reconnecting, refreshSessionSnapshot, resetRecovery, setChatMessages])

  const cancelSession = useCallback(async () => {
    const activeSessionId = sessionRef.current?.id
    if (!activeSessionId) {
      return
    }

    stopRecovery()
    setNeedsRecovery(false)
    setRecoveryBlocked(true)
    sessionRevisionRef.current++
    const results = adapter
      ? await Promise.allSettled([adapter.cancelSession(activeSessionId)])
      : await Promise.allSettled([chat.stop(), cancelAISession(activeSessionId)])
    await refreshSessionSnapshot(activeSessionId)

    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failure) {
      pushLocalError(toErrorMessage(failure.reason))
    }
  }, [adapter, chat, pushLocalError, refreshSessionSnapshot, stopRecovery])

  const detachSession = useCallback(() => {
    resetRecovery()
    sessionRevisionRef.current++
    closingSessionIdRef.current = sessionRef.current?.id ?? null
    setSession(null)
    sessionRef.current = null
    setError(null)
    chat.setMessages([])
    syncedMessagesKeyRef.current = null
    setTransport("idle")
  }, [chat, resetRecovery])

  const discardSessionIfEmpty = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) {
      return false
    }

    try {
      const response = adapter
        ? await adapter.getSession(targetSessionId)
        : await getAISession(targetSessionId)
      const targetSession = response.session
      if (
        targetSession.messages.length > 0
        || targetSession.ui_messages.length > 0
        || targetSession.tasks.length > 0
      ) {
        return false
      }

      if (adapter) {
        await adapter.deleteSession(targetSessionId)
      } else {
        await deleteAISession(targetSessionId)
      }
      if (sessionRef.current?.id === targetSessionId) {
        detachSession()
      }
      return true
    } catch {
      return false
    }
  }, [adapter, detachSession])

  const tasks = useMemo(
    () => [...(session?.tasks || [])].sort(compareTaskExecutionOrder),
    [session?.tasks]
  )
  const availableTools = useMemo<ToolView[]>(
    () => session?.available_tools ?? [],
    [session?.available_tools]
  )
  const canSend = Boolean(sessionId) && !needsRecovery && !reconnecting && session?.status === "idle" && (Boolean(adapter) || chat.status === "ready")
  const uiMessages = chat.messages
  const pendingApprovalCount = uiMessages.reduce((count, message) => count + message.parts.filter(
    (part) => isToolUIPart(part) && part.state === "approval-requested"
  ).length, 0)
  const speech = useMemo(() => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
    ? new WebSpeechSynthesisAdapter() : undefined, [])
  const { messages: runtimeMessages, feedback } = useAgentFeedback(sessionId, uiMessages)
  const runtime = useAISDKRuntime({
    ...chat,
    id: sessionId ?? chat.id,
    messages: runtimeMessages,
    error: needsRecovery && !recoveryBlocked ? undefined : chat.error,
    status: !recoveryBlocked && (needsRecovery || (session?.status === "running" && chat.status === "ready")) ? "streaming" : chat.status,
    addToolApprovalResponse: respondToToolApproval,
    stop: cancelSession,
  }, { joinStrategy: "none", cancelPendingToolCallsOnSend: false, adapters: { dictation, speech, feedback } })

  return {
    session,
    sessionId,
    transport,
    chatStatus: chat.status,
    uiMessages,
    tasks,
    pendingApprovalCount,
    runtime,
    availableTools,
    error,
    reconnecting,
    clearError,
    canSend,
    restoreLatestSession,
    restoreSession,
    startNewSession,
    sendMessage,
    updateMessage,
    regenerateMessage,
    continueRun,
    deleteMessage,
    cancelSession,
    detachSession,
    discardSessionIfEmpty,
  }
}
