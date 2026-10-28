import { QueryClient, QueryObserver, isCancelledError } from "@tanstack/react-query"
import type { LoadedSftpDirectory } from "./sftp-directory"
import type { SftpFileItem } from "../sftp-file-utils"

export type SftpDirectory = LoadedSftpDirectory<SftpFileItem>
export type SftpDirectoryLease = { promise: Promise<SftpDirectory>; release: () => void }

export function sftpParentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/"
}

/** 每个会话只有一份 Query 缓存。导航和展开节点各持有租约，最后释放者才取消请求。 */
export function createSftpDirectorySource(
  client: QueryClient,
  load: (path: string, signal: AbortSignal) => Promise<SftpDirectory>,
) {
  const consumers = new Map<string, number>()
  const generations = new Map<string, number>()
  const removalListeners = new Set<(paths: string[]) => void>()
  const fetch = (path: string, force = false) => client.fetchQuery({
    queryKey: [path],
    staleTime: force ? 0 : 30_000,
    queryFn: ({ signal }) => load(path, signal),
  }).then((directory) => {
    if (directory.path !== path) client.setQueryData([directory.path], directory)
    return directory
  })

  return {
    client,
    subscribeRemovals(listener: (paths: string[]) => void) {
      removalListeners.add(listener)
      return () => { removalListeners.delete(listener) }
    },
    acquire(path: string, force = false): SftpDirectoryLease {
      consumers.set(path, (consumers.get(path) ?? 0) + 1)
      // 租约同时持有 observer，展开的节点不会被 Query 的 GC 回收。
      const observer = new QueryObserver(client, {
        queryKey: [path], enabled: false, queryFn: ({ signal }) => load(path, signal),
      })
      const unsubscribe = observer.subscribe(() => undefined)
      let released = false
      const request = async () => {
        let generation = generations.get(path) ?? 0
        for (;;) {
          try { return await fetch(path, force) }
          catch (error) {
            const next = generations.get(path) ?? 0
            // 变更使旧读取失效时，仍在等待的导航跟随新请求；离开页面的租约不会重启。
            if (released || !isCancelledError(error) || next === generation) throw error
            generation = next
            force = true
          }
        }
      }
      return {
        promise: request(),
        release() {
          if (released) return
          released = true
          unsubscribe()
          const remaining = (consumers.get(path) ?? 1) - 1
          if (remaining > 0) consumers.set(path, remaining)
          else {
            consumers.delete(path)
            void client.cancelQueries({ queryKey: [path], exact: true })
          }
        },
      }
    },
    retry: (path: string) => fetch(path, true),
    invalidate(paths: string[], removedSubtrees: string[] = []) {
      const parents = new Set(paths)
      const matchesParent = (key: unknown, data: unknown) => (
        parents.has(String(key)) || parents.has((data as SftpDirectory | undefined)?.path ?? "")
      )
      for (const query of client.getQueryCache().getAll()) {
        if (matchesParent(query.queryKey[0], query.state.data)) parents.add(String(query.queryKey[0]))
      }
      for (const path of parents) generations.set(path, (generations.get(path) ?? 0) + 1)
      void client.cancelQueries({ predicate: (query) => matchesParent(query.queryKey[0], query.state.data) })
      void client.invalidateQueries({
        predicate: (query) => matchesParent(query.queryKey[0], query.state.data), refetchType: "none",
      })
      client.removeQueries({ predicate: (query) => removedSubtrees.some((path) => {
        const key = String(query.queryKey[0])
        const canonical = (query.state.data as SftpDirectory | undefined)?.path ?? key
        return [key, canonical].some((value) => value === path || value.startsWith(`${path}/`))
      }) })
      if (removedSubtrees.length) removalListeners.forEach((listener) => listener(removedSubtrees))
      // 只重查仍有导航或展开节点持有的父目录，不扫描整棵树。
      queueMicrotask(() => {
        for (const path of consumers.keys()) {
          if (parents.has(path)) void fetch(path, true).catch(() => undefined)
        }
      })
    },
  }
}

export type SftpDirectorySource = ReturnType<typeof createSftpDirectorySource>
