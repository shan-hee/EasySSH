import { useCallback, useEffect, useRef, useState } from "react"
import type { serversApi } from "@/lib/api/servers"
import type { Server, ServerStatisticsResponse } from "@/lib/server-types"

const PAGE_SIZE = 30

export function useServerConnectionList({ api, ready, search, group, busy }: {
  api: Pick<typeof serversApi, "list" | "getStatistics">
  ready: boolean
  search: string
  group: string
  busy: boolean
}) {
  const [servers, setServers] = useState<Server[]>([])
  const [statistics, setStatistics] = useState<ServerStatisticsResponse | null>(null)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [statisticsError, setStatisticsError] = useState<unknown>(null)
  const sequenceRef = useRef(0)
  const offsetRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const failedRequestRef = useRef<"reload" | "more">("reload")
  const statisticsSequenceRef = useRef(0)
  const pendingSyncRefreshRef = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 260)
    return () => window.clearTimeout(timer)
  }, [search])

  const refreshStatistics = useCallback(async () => {
    const sequence = ++statisticsSequenceRef.current
    try {
      const result = await api.getStatistics()
      if (sequence === statisticsSequenceRef.current) {
        setStatistics(result)
        setStatisticsError(null)
      }
    } catch (error) {
      if (sequence === statisticsSequenceRef.current) setStatisticsError(error)
    }
  }, [api])

  useEffect(() => {
    if (!ready) return
    void refreshStatistics()
    return () => { statisticsSequenceRef.current += 1 }
  }, [ready, refreshStatistics])

  const fetchPage = useCallback(async (page: number, replace: boolean, background = false) => {
    const sequence = replace ? ++sequenceRef.current : sequenceRef.current
    if (replace) {
      if (!background) setLoading(true)
      setLoadingMore(false)
      loadingMoreRef.current = background
      if (!background) setHasMore(false)
    } else {
      loadingMoreRef.current = true
      setLoadingMore(true)
    }
    setError(null)
    try {
      // Refresh every already loaded page without clearing the visible list.
      let response: Awaited<ReturnType<typeof api.list>>
      const refreshed: Server[] = []
      let loadedPage = background ? 1 : page
      do {
        response = await api.list({
          page: loadedPage, limit: PAGE_SIZE, search: query, group: group === "all" ? undefined : group,
        })
        if (sequence !== sequenceRef.current) return
        refreshed.push(...response.data)
        if (!background || loadedPage >= page || !response.data.length || loadedPage * PAGE_SIZE >= response.total) break
        loadedPage += 1
      } while (true)
      setServers(current => {
        if (replace) return refreshed
        const ids = new Set(current.map(server => server.id))
        return [...current, ...response.data.filter(server => !ids.has(server.id))]
      })
      offsetRef.current = loadedPage * PAGE_SIZE
      setHasMore(response.data.length > 0 && offsetRef.current < response.total)
    } catch (error) {
      if (sequence !== sequenceRef.current) return
      failedRequestRef.current = replace ? "reload" : "more"
      setError(error)
    } finally {
      if (sequence === sequenceRef.current) {
        setLoading(false)
        setLoadingMore(false)
        loadingMoreRef.current = false
      }
    }
  }, [api, group, query])

  const reload = useCallback(() => fetchPage(1, true), [fetchPage])
  useEffect(() => {
    if (!ready) return
    void reload()
    return () => { sequenceRef.current += 1 }
  }, [ready, reload])

  useEffect(() => {
    if (!ready) return
    const refresh = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail?.serversChanged === false) return
      if (busy) {
        pendingSyncRefreshRef.current = true
        return
      }
      pendingSyncRefreshRef.current = false
      void fetchPage(Math.max(1, Math.ceil(offsetRef.current / PAGE_SIZE)), true, true)
      void refreshStatistics()
    }
    if (pendingSyncRefreshRef.current && !busy) refresh()
    window.addEventListener("easyssh:sync-applied", refresh)
    return () => window.removeEventListener("easyssh:sync-applied", refresh)
  }, [ready, busy, fetchPage, refreshStatistics])

  const loadMore = useCallback(async () => {
    if (!ready || busy || loading || loadingMoreRef.current || !hasMore || search.trim() !== query) return
    await fetchPage(Math.floor(offsetRef.current / PAGE_SIZE) + 1, false)
  }, [busy, fetchPage, hasMore, loading, query, ready, search])

  const retry = useCallback(async () => {
    if (busy || loading || loadingMoreRef.current) return
    const replace = failedRequestRef.current === "reload"
    await Promise.all([
      error ? fetchPage(replace ? 1 : Math.floor(offsetRef.current / PAGE_SIZE) + 1, replace) : Promise.resolve(),
      refreshStatistics(),
    ])
  }, [busy, error, fetchPage, loading, refreshStatistics])

  // Cancel an in-flight page before mutating its ordering or membership.
  const cancelPendingPage = useCallback(() => {
    if (!loadingMoreRef.current) return
    sequenceRef.current += 1
    loadingMoreRef.current = false
    setLoadingMore(false)
  }, [])

  const remove = useCallback((id: string) => {
    cancelPendingPage()
    offsetRef.current = Math.max(0, offsetRef.current - 1)
    setServers(current => current.filter(server => server.id !== id))
  }, [cancelPendingPage])

  return {
    servers, setServers, statistics, loading, loadingMore, hasMore, error: error ?? statisticsError,
    loadMore, reload, retry, remove, cancelPendingPage, refreshStatistics,
    searchPending: search.trim() !== query,
  }
}
