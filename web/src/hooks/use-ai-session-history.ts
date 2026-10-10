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
  visible?: boolean
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
  const firstUserMessage = session.messages
    .find((message) => message.role === "user")
    ?.content.trim()
  if (!firstUserMessage) {
    return fallback
  }

  const chars = Array.from(firstUserMessage)
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : firstUserMessage
}

export function syncAISessionHistoryItems(
  items: SessionListItem[],
  session: SessionView,
  fallbackTitle: string,
  search: string,
) {
  const existing = items.find((item) => item.id === session.id)
  const title = existing?.custom_title
    ? existing.title
    : getDefaultAISessionTitle(session, fallbackTitle)
  const next = createSessionListItemFromSession(session, title, existing?.custom_title ?? false)
  const query = search.trim().toLocaleLowerCase()
  if (query && !next.title.toLocaleLowerCase().includes(query)) {
    return items.filter((item) => item.id !== session.id)
  }
  return [next, ...items.filter((item) => item.id !== session.id)]
}

export function useAISessionHistory({
  enabled,
  visible = false,
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const loadedOffsetRef = useRef(0)
  const loadedIdsRef = useRef(new Set<string>())
  const removedIdsRef = useRef(new Set<string>())
  const loadingMoreRef = useRef(false)
  const [error, setError] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const failedRequestRef = useRef<"reload" | "loadMore">("reload")
  const historyVisible = open || visible

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      setLoadingMore(false)
      loadingMoreRef.current = false
      return
    }

    const sequence = ++requestSequenceRef.current
    setLoading(true)
    setLoadingMore(false)
    loadingMoreRef.current = false
    setError("")
    try {
      const response = await listSessions({
        limit: SESSION_LIST_LIMIT,
        q: debouncedSearch,
        scope,
      })
      if (requestSequenceRef.current === sequence) {
        const remaining = response.items.filter((item) => !removedIdsRef.current.has(item.id))
        setItems(remaining)
        loadedOffsetRef.current = SESSION_LIST_LIMIT - (response.items.length - remaining.length)
        loadedIdsRef.current = new Set(remaining.map((item) => item.id))
        setHasMore(response.items.length > 0 && SESSION_LIST_LIMIT < response.total)
      }
    } catch {
      if (requestSequenceRef.current === sequence) {
        failedRequestRef.current = "reload"
        setError(loadErrorMessage)
      }
    } finally {
      if (requestSequenceRef.current === sequence) {
        setLoading(false)
      }
    }
  }, [debouncedSearch, enabled, listSessions, loadErrorMessage, scope])

  useEffect(() => {
    if (historyVisible) {
      void reload()
      return () => {
        requestSequenceRef.current += 1
      }
    }

    requestSequenceRef.current += 1
    setLoading(false)
    setLoadingMore(false)
    loadingMoreRef.current = false
  }, [historyVisible, reload])

  useEffect(() => {
    const refresh = () => {
      if (historyVisible && document.visibilityState === "visible" && !renamingId && !actionLoadingId && !loadingMoreRef.current && loadedOffsetRef.current <= SESSION_LIST_LIMIT) void reload()
    }
    const timer = historyVisible ? window.setInterval(refresh, 15000) : undefined
    window.addEventListener("easyssh:sync-applied", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      window.removeEventListener("easyssh:sync-applied", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [actionLoadingId, historyVisible, reload, renamingId])

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      !historyVisible ||
      loading ||
      loadingMoreRef.current ||
      actionLoadingId ||
      renamingId ||
      !hasMore ||
      search.trim() !== debouncedSearch
    )
      return
    const sequence = requestSequenceRef.current
    // Deletions shift offset pagination. Re-read the boundary page and deduplicate
    // instead of skipping records or replacing all previously loaded pages.
    const page = Math.floor(loadedOffsetRef.current / SESSION_LIST_LIMIT) + 1
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError("")
    try {
      const response = await listSessions({
        page,
        limit: SESSION_LIST_LIMIT,
        q: debouncedSearch,
        scope,
      })
      if (sequence !== requestSequenceRef.current) return
      const remaining = response.items.filter((item) => !removedIdsRef.current.has(item.id))
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id))
        return [...current, ...remaining.filter((item) => !ids.has(item.id))]
      })
      loadedOffsetRef.current = page * SESSION_LIST_LIMIT - (response.items.length - remaining.length)
      remaining.forEach((item) => loadedIdsRef.current.add(item.id))
      setHasMore(response.items.length > 0 && page * SESSION_LIST_LIMIT < response.total)
    } catch {
      if (sequence === requestSequenceRef.current) {
        failedRequestRef.current = "loadMore"
        setError(loadErrorMessage)
      }
    } finally {
      if (sequence === requestSequenceRef.current) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [actionLoadingId, debouncedSearch, enabled, hasMore, historyVisible, listSessions, loadErrorMessage, loading, renamingId, scope, search])

  const retry = useCallback(
    () => failedRequestRef.current === "loadMore" ? loadMore() : reload(),
    [loadMore, reload],
  )

  const prepend = useCallback(
    (response: CreateSessionResponse, title: string) => {
      if (search.trim()) {
        return
      }
      setItems((current) => [
        createAISessionListItem(response, title),
        ...current.filter((item) => item.id !== response.session_id),
      ])
    },
    [search],
  )

  const findEmptySession = useCallback(
    async (targetScope: AgentSessionScope) => {
      // Search the actual scoped history, independently of the visible search or page.
      for (let page = 1; ; page++) {
        const response = await listSessions({ page, limit: SESSION_LIST_LIMIT, scope: targetScope })
        const empty = response.items.find(
          (item) => item.status === "idle" && item.message_count === 0 && item.task_count === 0,
        )
        if (empty) return empty.id
        if (response.items.length === 0 || page * SESSION_LIST_LIMIT >= response.total) return null
      }
    },
    [listSessions],
  )

  const syncSession = useCallback(
    (session: SessionView, fallbackTitle: string) => {
      if (removedIdsRef.current.has(session.id)) return
      setItems((current) => syncAISessionHistoryItems(current, session, fallbackTitle, search))
    },
    [search],
  )

  const beginRename = useCallback((item: SessionListItem) => {
    setRenamingId(item.id)
    setRenameDraft(item.title)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameDraft("")
  }, [])

  const submitRename = useCallback(
    async (sessionId: string) => {
      const title = renameDraft.trim()
      if (!title || actionLoadingId) {
        return false
      }

      setActionLoadingId(sessionId)
      setError("")
      const sequence = requestSequenceRef.current
      try {
        await renameSession(sessionId, title)
        const isCurrentRequest = sequence === requestSequenceRef.current
        if (isCurrentRequest) {
          requestSequenceRef.current += 1
          setLoading(false)
          setLoadingMore(false)
          loadingMoreRef.current = false
        }
        setItems((current) =>
          current.map((item) =>
            item.id === sessionId
              ? { ...item, title, custom_title: true, updated_at: new Date().toISOString() }
              : item,
          ),
        )
        cancelRename()
        // Search includes message content, so only the server can determine
        // whether a renamed session still matches the current query.
        if (isCurrentRequest && (loading || debouncedSearch)) void reload()
        return true
      } catch {
        failedRequestRef.current = "reload"
        setError(renameErrorMessage)
        return false
      } finally {
        setActionLoadingId(null)
      }
    },
    [
      actionLoadingId,
      cancelRename,
      debouncedSearch,
      loading,
      reload,
      renameDraft,
      renameErrorMessage,
      renameSession,
    ],
  )

  const remove = useCallback(
    async (sessionId: string) => {
      if (!sessionId || actionLoadingId) {
        return false
      }

      setActionLoadingId(sessionId)
      setError("")
      const sequence = requestSequenceRef.current
      try {
        await deleteSession(sessionId)
        removedIdsRef.current.add(sessionId)
        // A list request started before deletion must not restore the removed row.
        if (sequence === requestSequenceRef.current) {
          requestSequenceRef.current += 1
          setLoading(false)
          setLoadingMore(false)
          loadingMoreRef.current = false
          if (loading) void reload()
        }
        if (loadedIdsRef.current.delete(sessionId)) {
          loadedOffsetRef.current = Math.max(0, loadedOffsetRef.current - 1)
        }
        setItems((current) => current.filter((item) => item.id !== sessionId))
        if (renamingId === sessionId) {
          cancelRename()
        }
        return true
      } catch {
        failedRequestRef.current = "reload"
        setError(deleteErrorMessage)
        return false
      } finally {
        setActionLoadingId(null)
      }
    },
    [actionLoadingId, cancelRename, deleteErrorMessage, deleteSession, loading, reload, renamingId],
  )

  const forget = useCallback(
    (sessionId: string) => {
      removedIdsRef.current.add(sessionId)
      if (loadedIdsRef.current.delete(sessionId)) {
        loadedOffsetRef.current = Math.max(0, loadedOffsetRef.current - 1)
      }
      setItems((current) => current.filter((item) => item.id !== sessionId))
      if (renamingId === sessionId) {
        cancelRename()
      }
    },
    [cancelRename, renamingId],
  )

  return {
    open,
    setOpen,
    search,
    setSearch,
    items,
    loading,
    loadingMore,
    hasMore,
    loadMore,
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
    forget,
    prepend,
    findEmptySession,
    syncSession,
    reload,
    retry,
  }
}

export type AISessionHistoryState = ReturnType<typeof useAISessionHistory>
