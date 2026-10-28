import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { SftpDirectory, SftpDirectoryLease, SftpDirectorySource } from "@/lib/session/sftp-directory-source"
import { joinSftpRemotePath } from "@/lib/sftp-file-utils"

export interface SftpTreeNode {
  path: string
  name: string
  type: "file" | "directory"
  depth: number
  parent: string | null
  position: number
  siblings: number
}

function ancestors(path: string, includeSelf: boolean): string[] {
  if (!path.startsWith("/")) return ["/"]
  const parts = path.split("/").filter(Boolean)
  const count = includeSelf ? parts.length : parts.length - 1
  return ["/", ...Array.from({ length: Math.max(0, count) }, (_, index) => `/${parts.slice(0, index + 1).join("/")}`)]
}

export function useSftpFileTreeController({ source, currentPath, editorPath, showHidden, visible }: {
  source: SftpDirectorySource
  currentPath: string
  editorPath?: string
  showHidden: boolean
  visible: boolean
}) {
  const [expanded, setExpanded] = useState(() => new Set(ancestors(currentPath, true)))
  const [focusPath, setFocusPath] = useState(currentPath)
  const leases = useRef(new Map<string, SftpDirectoryLease>())
  const subscription = useMemo(() => {
    let revision = 0
    return {
      subscribe: (notify: () => void) => source.client.getQueryCache().subscribe((event) => {
        if (event.type === "added" || event.type === "removed" || event.type === "updated") { revision++; notify() }
      }),
      snapshot: () => revision,
    }
  }, [source])
  const revision = useSyncExternalStore(subscription.subscribe, subscription.snapshot, subscription.snapshot)
  const targetPath = editorPath || currentPath

  useEffect(() => {
    setExpanded((previous) => new Set([...previous, ...ancestors(currentPath, true), ...ancestors(editorPath || currentPath, !editorPath)]))
    setFocusPath(targetPath)
  }, [currentPath, editorPath, targetPath])

  useEffect(() => source.subscribeRemovals((removed) => {
    setExpanded((previous) => {
      const next = new Set(Array.from(previous).filter((path) => !removed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))))
      return next.size === previous.size ? previous : next
    })
  }), [source])

  const nodes = useMemo(() => {
    const result: SftpTreeNode[] = []
    // 服务器可能允许访问已知目录但禁止列出它的父目录，保留已知路径供定位。
    const known = new Set([...ancestors(currentPath, true), ...ancestors(editorPath || currentPath, !editorPath)])
    const visit = (node: SftpTreeNode) => {
      result.push(node)
      if (node.type !== "directory" || !expanded.has(node.path)) return
      const directory = source.client.getQueryData<SftpDirectory>([node.path])
      let children: Array<{ name: string; type: "file" | "directory" }> = directory?.files ?? []
      if (!directory) {
        children = Array.from(known).filter((path) => path !== "/" && (path.slice(0, path.lastIndexOf("/")) || "/") === node.path)
          .map((path) => ({ name: path.slice(path.lastIndexOf("/") + 1), type: "directory" as const }))
      }
      const sorted = children.filter((child) => child.name !== "." && child.name !== ".." && (showHidden || !child.name.startsWith(".")))
        .sort((a, b) => a.type !== b.type ? a.type === "directory" ? -1 : 1 : a.name.localeCompare(b.name))
      sorted.forEach((child, index) => visit({
        ...child, path: joinSftpRemotePath(node.path, child.name), depth: node.depth + 1,
        parent: node.path, position: index + 1, siblings: sorted.length,
      }))
    }
    visit({ path: "/", name: "/", type: "directory", depth: 0, parent: null, position: 1, siblings: 1 })
    return result
  }, [source, expanded, revision, showHidden, currentPath, editorPath])

  useEffect(() => {
    const needed = new Set(visible ? nodes.filter((node) => node.type === "directory" && expanded.has(node.path)).map((node) => node.path) : [])
    for (const [path, lease] of leases.current) {
      if (!needed.has(path)) { lease.release(); leases.current.delete(path) }
    }
    for (const path of needed) {
      if (leases.current.has(path)) continue
      const lease = source.acquire(path)
      leases.current.set(path, lease)
      void lease.promise.catch(() => undefined)
    }
  }, [source, nodes, expanded, visible])

  useEffect(() => {
    const active = leases.current
    return () => { active.forEach((lease) => lease.release()); active.clear() }
  }, [source])

  const toggle = useCallback((path: string) => setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  }), [])

  return { nodes, expanded, focusPath, setFocusPath, toggle }
}
