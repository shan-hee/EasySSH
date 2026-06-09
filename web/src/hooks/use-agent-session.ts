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

function emptySessionMessages(session: SessionView | null) {
  return session?.ui_messages ?? []
}

export function useAgentSession(adapter?: AgentSessionAdapter) {
  const [session, setSession] = useState<SessionView | null>(null)
  const [transport, setTransport] = useState<TransportState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [localErrorMessages, setLocalErrorMessages] = useState<UIMessage[]>([])

  const sessionRef = useRef<SessionView | null>(null)
  const latestRestoreAttemptedRef = useRef(false)
  const closingSessionIdRef = useRef<string | null>(null)
  const restoredMessagesSessionIdRef = useRef<string | null>(null)
  const idleChatIdRef = useRef(createLocalId("agent-chat"))

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const sessionId = session?.id ?? null
  const chatId = sessionId ?? idleChatIdRef.current

  const chatTransport = useMemo(
    () => new DefaultChatTransport<UIMessage>({
      api: sessionId ? getApiUrl(`/ai/sessions/${sessionId}/chat`) : getApiUrl("/ai/sessions/__idle__/chat"),
      headers: () => getAuthHeaders(),
    }),
    [sessionId]
  )

  const refreshSessionSnapshot = useCallback(async (targetSessionId = sessionRef.current?.id) => {
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
      setSession(response.session)
      setTransport(adapter ? "desktop_local" : "ai_sdk_ui")
      return response.session
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      setError(message)
      return null
    }
  }, [adapter])

  const chat = useChat<UIMessage>({
    id: chatId,
    messages: emptySessionMessages(session),
    transport: chatTransport,
    onError(chatError) {
      setError(chatError.message)
      setTransport(sessionRef.current ? "ai_sdk_ui" : "idle")
    },
    onFinish() {
      void refreshSessionSnapshot()
    },
  })

  useEffect(() => {
    if (!session?.id) {
      restoredMessagesSessionIdRef.current = null
      return
    }

    if (restoredMessagesSessionIdRef.current === session.id) {
      return
    }

    chat.setMessages(session.ui_messages || [])
    restoredMessagesSessionIdRef.current = session.id
  }, [chat, session?.id, session?.ui_messages])

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

  const applySessionResponse = useCallback((response: CreateSessionResponse) => {
    closingSessionIdRef.current = null
    setError(null)
    setLocalErrorMessages([])
    setSession(response.session)
    setTransport(adapter ? "desktop_local" : "ai_sdk_ui")
    restoredMessagesSessionIdRef.current = null
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
      pushLocalError(restoreError instanceof Error ? restoreError.message : String(restoreError))
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
      if (!input.silent) {
        pushLocalError(restoreError instanceof Error ? restoreError.message : String(restoreError))
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
      applySessionResponse(response)
      return response
    } catch (createError) {
      setTransport(currentSession ? "ai_sdk_ui" : "idle")
      pushLocalError(createError instanceof Error ? createError.message : String(createError))
      return null
    }
  }, [adapter, applySessionResponse, pushLocalError])

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
          context: contextText,
          model,
          permission_mode: permissionMode,
          scope,
        },
      })
      return true
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
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
          approval: {
            task_id: taskId,
            decision,
          },
        },
      })
    } catch (confirmError) {
      pushLocalError(confirmError instanceof Error ? confirmError.message : String(confirmError))
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
      pushLocalError(cancelError instanceof Error ? cancelError.message : String(cancelError))
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
    setError(null)
    setLocalErrorMessages([])
    chat.setMessages([])
    restoredMessagesSessionIdRef.current = null
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
  const uiMessages = adapter
    ? [...(session?.ui_messages || []), ...localErrorMessages]
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
