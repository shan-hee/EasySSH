import { useCallback, useEffect, useRef, useState } from "react"

import type {
  AgentSessionScope,
  CreateSessionResponse,
  ListSessionsResponse,
  SessionListItem,
  SessionView,
} from "@/lib/api/ai-agent"

const SESSION_LIST_LIMIT = 30
const SEARCH_DEBOUNCE_MS = 260

type ListSessions = (input?: {
  page?: number
  limit?: number
  q?: string
  scope?: AgentSessionScope
}) => Promise<ListSessionsResponse>

interface UseAISessionHistoryOptions {
  enabled: boolean
  listSessions: ListSessions
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  scope?: AgentSessionScope
  loadErrorMessage: string
  renameErrorMessage: string
  deleteErrorMessage: string
}

function createSessionListItemFromSession(
  session: SessionView,
  title: string,
  customTitle = false,
): SessionListItem {
  return {
    id: session.id,
    model: session.model,
    permission_mode: session.permission_mode,
    status: session.status,
    scope: session.scope,
    title,
    custom_title: customTitle,
    message_count: session.messages.length,
    task_count: session.tasks.length,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }
}

export function createAISessionListItem(response: CreateSessionResponse, title: string) {
  return createSessionListItemFromSession(response.session, title)
}

export function getDefaultAISessionTitle(session: SessionView, fallback: string) {
  const firstUserMessage = session.messages.find((message) => message.role === "user")?.content.trim()
  if (!firstUserMessage) {
    return fallback
  }

  const chars = Array.from(firstUserMessage)
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : firstUserMessage
}

export function useAISessionHistory({
  enabled,
  listSessions,
  renameSession,
  deleteSession,
  scope,
  loadErrorMessage,
  renameErrorMessage,
  deleteErrorMessage,
}: UseAISessionHistoryOptions) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [items, setItems] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const reload = useCallback(async () => {
    if (!enabled) {
      return
    }

    const sequence = ++requestSequenceRef.current
    setLoading(true)
    setError("")
    try {
      const response = await listSessions({
        limit: SESSION_LIST_LIMIT,
        q: debouncedSearch,
        scope,
      })
      if (requestSequenceRef.current === sequence) {
        setItems(response.items)
      }
    } catch {
      if (requestSequenceRef.current === sequence) {
        setError(loadErrorMessage)
      }
    } finally {
      if (requestSequenceRef.current === sequence) {
        setLoading(false)
      }
    }
  }, [debouncedSearch, enabled, listSessions, loadErrorMessage, scope])

  useEffect(() => {
    if (open) {
      void reload()
      return
    }

    requestSequenceRef.current += 1
    setLoading(false)
  }, [open, reload])

  const prepend = useCallback((response: CreateSessionResponse, title: string) => {
    if (search.trim()) {
      return
    }
    setItems((current) => [
      createAISessionListItem(response, title),
      ...current.filter((item) => item.id !== response.session_id),
    ].slice(0, SESSION_LIST_LIMIT))
  }, [search])

  const syncSession = useCallback((session: SessionView, fallbackTitle: string) => {
    if (!open) {
      return
    }
    setItems((current) => {
      const existing = current.find((item) => item.id === session.id)
      const title = existing?.custom_title
        ? existing.title
        : getDefaultAISessionTitle(session, fallbackTitle)
      const next = createSessionListItemFromSession(session, title, existing?.custom_title ?? false)
      const query = search.trim().toLocaleLowerCase()
      if (query && !next.title.toLocaleLowerCase().includes(query)) {
        return current.filter((item) => item.id !== session.id)
      }
      return [next, ...current.filter((item) => item.id !== session.id)].slice(0, SESSION_LIST_LIMIT)
    })
  }, [open, search])

  const beginRename = useCallback((item: SessionListItem) => {
    setRenamingId(item.id)
    setRenameDraft(item.title)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameDraft("")
  }, [])

  const submitRename = useCallback(async (sessionId: string) => {
    const title = renameDraft.trim()
    if (!title || actionLoadingId) {
      return false
    }

    setActionLoadingId(sessionId)
    setError("")
    try {
      await renameSession(sessionId, title)
      setItems((current) => current.map((item) => (
        item.id === sessionId
          ? { ...item, title, custom_title: true, updated_at: new Date().toISOString() }
          : item
      )))
      cancelRename()
      return true
    } catch {
      setError(renameErrorMessage)
      return false
    } finally {
      setActionLoadingId(null)
    }
  }, [actionLoadingId, cancelRename, renameDraft, renameErrorMessage, renameSession])

  const remove = useCallback(async (sessionId: string) => {
    if (!sessionId || actionLoadingId) {
      return false
    }

    setActionLoadingId(sessionId)
    setError("")
    try {
      await deleteSession(sessionId)
      setItems((current) => current.filter((item) => item.id !== sessionId))
      if (renamingId === sessionId) {
        cancelRename()
      }
      return true
    } catch {
      setError(deleteErrorMessage)
      return false
    } finally {
      setActionLoadingId(null)
    }
  }, [actionLoadingId, cancelRename, deleteErrorMessage, deleteSession, renamingId])

  return {
    open,
    setOpen,
    search,
    setSearch,
    items,
    loading,
    error,
    clearError: () => setError(""),
    renamingId,
    renameDraft,
    setRenameDraft,
    actionLoadingId,
    beginRename,
    cancelRename,
    submitRename,
    remove,
    prepend,
    syncSession,
    reload,
  }
}
