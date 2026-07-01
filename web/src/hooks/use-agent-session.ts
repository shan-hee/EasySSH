import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat, type UIMessage } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
  cancelAISession,
  closeAISession,
  createAISession,
  getAISession,
  getLatestAISession,
  type AgentSessionScope,
  type CreateSessionResponse,
  type PermissionMode,
  type SessionView,
  type ToolView,
} from "@/lib/api/ai-agent"
import { getApiUrl, getAuthHeaders } from "@/lib/api-client"

type TransportState = "idle" | "connecting" | "ai_sdk_ui" | "desktop_local"
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
  }) => Promise<CreateSessionResponse>
  cancelSession: (sessionId: string) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getSessionChatApi(sessionId?: string | null) {
  return getApiUrl(`/ai/sessions/${sessionId?.trim() || "__idle__"}/chat`)
}

function getSessionMessagesSyncKey(session: SessionView) {
  const messages = session.ui_messages ?? []

  return `${session.id}:${JSON.stringify(messages)}`
}

export function useAgentSession(adapter?: AgentSessionAdapter) {
  const [session, setSession] = useState<SessionView | null>(null)
  const [transport, setTransport] = useState<TransportState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [localErrorMessages, setLocalErrorMessages] = useState<UIMessage[]>([])

  const sessionRef = useRef<SessionView | null>(null)
  const latestRestoreAttemptedRef = useRef(false)
  const closingSessionIdRef = useRef<string | null>(null)
  const syncedMessagesKeyRef = useRef<string | null>(null)
  const idleChatIdRef = useRef(createLocalId("agent-chat"))

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const sessionId = session?.id ?? null
  const chatId = idleChatIdRef.current

  const chatTransport = useMemo(
    () => new DefaultChatTransport<UIMessage>({
      api: getSessionChatApi(null),
      headers: () => getAuthHeaders(),
      prepareSendMessagesRequest(options) {
        const body = options.body ?? {}
        const targetSessionIdValue = body[TARGET_SESSION_ID_BODY_KEY]
        const targetSessionId = typeof targetSessionIdValue === "string"
          ? targetSessionIdValue.trim()
          : ""
        const requestBody = { ...body }
        delete requestBody[TARGET_SESSION_ID_BODY_KEY]

        return {
          api: targetSessionId ? getSessionChatApi(targetSessionId) : options.api,
          headers: options.headers,
          credentials: options.credentials,
          body: {
            ...requestBody,
            id: options.id,
            messages: options.messages,
            trigger: options.trigger,
            messageId: options.messageId,
          },
        }
      },
    }),
    []
  )

  const refreshSessionSnapshot = useCallback(async (
    targetSessionId = sessionRef.current?.id,
    input: { syncMessages?: boolean } = {}
  ) => {
    if (!targetSessionId || closingSessionIdRef.current === targetSessionId) {
      return null
    }

    try {
      const response = adapter
        ? await adapter.getSession(targetSessionId)
        : await getAISession(targetSessionId)
      if (closingSessionIdRef.current === targetSessionId) {
        return null
      }
      syncedMessagesKeyRef.current = input.syncMessages === false
        ? getSessionMessagesSyncKey(response.session)
        : null
      sessionRef.current = response.session
      setSession(response.session)
      setTransport(adapter ? "desktop_local" : "ai_sdk_ui")
      return response.session
    } catch (refreshError) {
      const message = toErrorMessage(refreshError)
      setError(message)
      return null
    }
  }, [adapter])

  const chat = useChat<UIMessage>({
    id: chatId,
    messages: [],
    transport: chatTransport,
    onError(chatError) {
      setError(chatError.message)
      setTransport(sessionRef.current ? "ai_sdk_ui" : "idle")
    },
    onFinish() {
      void refreshSessionSnapshot(undefined, { syncMessages: false })
    },
  })

  useEffect(() => {
    if (!session?.id) {
      syncedMessagesKeyRef.current = null
      return
    }

    const syncKey = getSessionMessagesSyncKey(session)
    if (syncedMessagesKeyRef.current === syncKey) {
      return
    }

    chat.setMessages(session.ui_messages || [])
    syncedMessagesKeyRef.current = syncKey
  }, [chat, session])

  const pushLocalError = useCallback((message: string) => {
    setError(message)
    setLocalErrorMessages((current) => [
      ...current,
      {
        id: createLocalId("error"),
        role: "assistant",
        metadata: {
          source: "local-error",
          createdAt: new Date().toISOString(),
        },
        parts: [
          {
            type: "data-error",
            id: createLocalId("error-part"),
            data: { message },
          },
        ],
      } satisfies UIMessage,
    ])
  }, [])

  const applySessionResponse = useCallback((
    response: CreateSessionResponse,
    input: { syncMessages?: boolean } = {}
  ) => {
    closingSessionIdRef.current = null
    setError(null)
    setLocalErrorMessages([])
    sessionRef.current = response.session
    setSession(response.session)
    setTransport(adapter ? "desktop_local" : "ai_sdk_ui")
    syncedMessagesKeyRef.current = input.syncMessages === false
      ? getSessionMessagesSyncKey(response.session)
      : null
    return response
  }, [adapter])

  const restoreLatestSession = useCallback(async (scope?: AgentSessionScope) => {
    if (latestRestoreAttemptedRef.current || sessionRef.current || transport !== "idle") {
      return false
    }

    latestRestoreAttemptedRef.current = true
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

    setTransport("connecting")

    try {
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
  }, [adapter, applySessionResponse, pushLocalError])

  const startNewSession = useCallback(async (input: { model?: string; permissionMode?: PermissionMode; scope?: AgentSessionScope }) => {
    latestRestoreAttemptedRef.current = true
    setError(null)
    setLocalErrorMessages([])
    setTransport("connecting")

    const currentSession = sessionRef.current
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
  }, [adapter, applySessionResponse, chat, pushLocalError])

  const sendMessage = useCallback(async (
    content: string,
    contextText?: string,
    model?: string,
    permissionMode?: PermissionMode,
    scope?: AgentSessionScope
  ) => {
    const activeSessionId = sessionRef.current?.id
    const normalizedContent = content.trim()
    if (!activeSessionId || !normalizedContent) {
      return false
    }

    setError(null)
    setSession((current) => current
      ? { ...current, status: "running", updated_at: new Date().toISOString() }
      : current
    )
    setTransport(adapter ? "desktop_local" : "ai_sdk_ui")

    try {
      if (adapter) {
        const response = await adapter.sendMessage({
          session_id: activeSessionId,
          content: normalizedContent,
          context: contextText,
          model,
          permission_mode: permissionMode,
          scope,
        })
        applySessionResponse(response)
        return true
      }

      await chat.sendMessage({ text: normalizedContent }, {
        body: {
          [TARGET_SESSION_ID_BODY_KEY]: activeSessionId,
          context: contextText,
          model,
          permission_mode: permissionMode,
          scope,
        },
      })
      return true
    } catch (sendError) {
      const message = toErrorMessage(sendError)
      pushLocalError(message)
      void refreshSessionSnapshot(activeSessionId)
      return false
    }
  }, [adapter, applySessionResponse, chat, pushLocalError, refreshSessionSnapshot])

  const confirmTask = useCallback(async (taskId: string, decision: "confirm" | "reject") => {
    const activeSessionId = sessionRef.current?.id
    if (!activeSessionId || !taskId) {
      return
    }

    setError(null)
    if (adapter) {
      pushLocalError("当前桌面 AI 模式暂不需要工具确认")
      return
    }

    const task = sessionRef.current?.tasks.find((item) => item.id === taskId)
    if (task && task.status !== "waiting_confirm") {
      return
    }

    try {
      setTransport("ai_sdk_ui")
      await chat.sendMessage(undefined, {
        body: {
          [TARGET_SESSION_ID_BODY_KEY]: activeSessionId,
          approval: {
            task_id: taskId,
            decision,
          },
        },
      })
    } catch (confirmError) {
      const message = toErrorMessage(confirmError)
      pushLocalError(message)
      void refreshSessionSnapshot(activeSessionId)
    }
  }, [adapter, chat, pushLocalError, refreshSessionSnapshot])

  const cancelSession = useCallback(async () => {
    const activeSessionId = sessionRef.current?.id
    if (!activeSessionId) {
      return
    }

    try {
      if (adapter) {
        await adapter.cancelSession(activeSessionId)
      } else {
        await chat.stop()
        await cancelAISession(activeSessionId)
      }
      await refreshSessionSnapshot(activeSessionId)
    } catch (cancelError) {
      const message = toErrorMessage(cancelError)
      pushLocalError(message)
    }
  }, [adapter, chat, pushLocalError, refreshSessionSnapshot])

  const closeSession = useCallback(async () => {
    const activeSessionId = sessionRef.current?.id
    if (activeSessionId) {
      closingSessionIdRef.current = activeSessionId
      try {
        if (adapter) {
          await adapter.closeSession(activeSessionId)
        } else {
          await closeAISession(activeSessionId)
        }
      } catch {
        // ignore close errors for local detach
      }
    }

    setSession(null)
    sessionRef.current = null
    setError(null)
    setLocalErrorMessages([])
    chat.setMessages([])
    syncedMessagesKeyRef.current = null
    closingSessionIdRef.current = null
    latestRestoreAttemptedRef.current = true
    setTransport("idle")
  }, [adapter, chat])

  const tasks = useMemo(
    () => [...(session?.tasks || [])].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    ),
    [session?.tasks]
  )
  const pendingConfirmationTasks = tasks.filter((task) => task.status === "waiting_confirm")
  const availableTools: ToolView[] = session?.available_tools || []
  const canSend = Boolean(sessionId) && session?.status === "idle" && (Boolean(adapter) || chat.status === "ready")
  const snapshotMessages = session?.ui_messages || []
  const uiMessages = adapter
    ? [...snapshotMessages, ...localErrorMessages]
    : [...chat.messages, ...localErrorMessages]

  return {
    session,
    sessionId,
    transport,
    chatStatus: chat.status,
    timeline: [],
    uiMessages,
    tasks,
    pendingConfirmationTasks,
    availableTools,
    error,
    canSend,
    restoreLatestSession,
    restoreSession,
    startNewSession,
    sendMessage,
    confirmTask,
    cancelSession,
    closeSession,
  }
}
