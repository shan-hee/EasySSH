import { useEffect, useId, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight, File, Folder, FolderOpen, LoaderCircle, CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import type { SftpDirectorySource } from "@/lib/session/sftp-directory-source"
import { useSftpFileTreeController } from "./use-sftp-file-tree-controller"

export function SftpFileTreePane({ source, currentPath, editorPath, showHidden, visible, onNavigate, onOpenFile, onDismiss }: {
  source: SftpDirectorySource
  currentPath: string
  editorPath?: string
  showHidden: boolean
  visible: boolean
  onNavigate: (path: string) => void
  onOpenFile: (path: string) => void
  onDismiss: () => void
}) {
  "use no memo" // TanStack Virtual exposes a mutable instance; render its current items directly.

  const t = useWorkspaceSftpTranslator()
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const lastRevealed = useRef<{ path: string; index: number } | null>(null)
  const id = useId()
  const tree = useSftpFileTreeController({ source, currentPath, editorPath, showHidden, visible })
  // This component explicitly opts out above; keep the exception local to the mutable API.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tree.nodes.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 28, overscan: 8, getItemKey: (index) => tree.nodes[index].path,
    enabled: visible,
  })
  const focusedIndex = tree.nodes.findIndex((node) => node.path === tree.focusPath)
  const focusIndex = Math.max(0, focusedIndex)
  const items = virtualizer.getVirtualItems()
  const activeIndex = items.some((item) => item.index === focusIndex) ? focusIndex : undefined

  useEffect(() => {
    if (visible && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current
  }, [visible])
  useEffect(() => {
    if (!visible || focusedIndex < 0) return
    const previous = lastRevealed.current
    if (previous?.path !== tree.focusPath || previous.index !== focusedIndex) {
      virtualizer.scrollToIndex(focusedIndex, { align: "auto" })
      lastRevealed.current = { path: tree.focusPath, index: focusedIndex }
    }
    // 只在焦点/导航改变时定位，不抢走用户的滚动位置。
  }, [tree.focusPath, focusedIndex, visible, virtualizer])

  const focus = (index: number) => {
    const node = tree.nodes[Math.min(Math.max(index, 0), tree.nodes.length - 1)]
    if (node) { tree.setFocusPath(node.path); virtualizer.scrollToIndex(Math.max(0, tree.nodes.indexOf(node)), { align: "auto" }) }
  }

  return <div
    ref={scrollRef}
    role="tree"
    aria-label={t("treeLabel")}
    aria-activedescendant={activeIndex === undefined ? undefined : `${id}-${activeIndex}`}
    tabIndex={visible ? 0 : -1}
    className="h-full min-h-0 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    onScroll={(event) => { if (visible) savedScroll.current = event.currentTarget.scrollTop }}
    onKeyDown={(event) => {
      event.stopPropagation()
      const node = tree.nodes[focusIndex]
      if (!node || event.altKey || event.ctrlKey || event.metaKey) return
      switch (event.key) {
        case "ArrowDown": event.preventDefault(); focus(focusIndex + 1); break
        case "ArrowUp": event.preventDefault(); focus(focusIndex - 1); break
        case "Home": event.preventDefault(); focus(0); break
        case "End": event.preventDefault(); focus(tree.nodes.length - 1); break
        case "ArrowRight":
          event.preventDefault()
          if (node.type === "directory") {
            if (!tree.expanded.has(node.path)) tree.toggle(node.path)
            else if (tree.nodes[focusIndex + 1]?.parent === node.path) focus(focusIndex + 1)
          }
          break
        case "ArrowLeft":
          event.preventDefault()
          if (node.type === "directory" && tree.expanded.has(node.path)) tree.toggle(node.path)
          else if (node.parent) tree.setFocusPath(node.parent)
          break
        case "Enter": event.preventDefault(); (node.type === "directory" ? onNavigate : onOpenFile)(node.path); break
        case " ": event.preventDefault(); if (node.type === "directory") tree.toggle(node.path); break
        case "Escape": event.preventDefault(); onDismiss(); break
      }
    }}
  >
    <div className="relative min-w-full" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const node = tree.nodes[item.index]
        const isDirectory = node.type === "directory"
        const expanded = isDirectory && tree.expanded.has(node.path)
        const state = isDirectory ? source.client.getQueryState([node.path]) : undefined
        const loading = expanded && state?.fetchStatus === "fetching"
        const failed = state?.status === "error"
        const current = node.path === currentPath
        const editing = node.path === editorPath
        const Icon = isDirectory ? expanded ? FolderOpen : Folder : File
        return <div
          id={`${id}-${item.index}`}
          key={node.path}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-posinset={node.position}
          aria-setsize={node.siblings}
          aria-expanded={isDirectory ? expanded : undefined}
          aria-selected={editing || (!editorPath && current)}
          aria-current={current ? "location" : undefined}
          aria-busy={loading}
          title={node.path}
          className={cn(
            "absolute left-0 flex h-7 w-full cursor-default items-center gap-1 pr-2 text-xs select-none hover:bg-accent/60",
            current && "bg-accent/60 font-medium",
            editing && "bg-primary/10 text-primary font-medium",
            tree.focusPath === node.path && "ring-1 ring-inset ring-ring/50",
          )}
          style={{ transform: `translateY(${item.start}px)`, paddingLeft: 6 + node.depth * 14 }}
          onClick={() => {
            scrollRef.current?.focus({ preventScroll: true })
            tree.setFocusPath(node.path)
            if (isDirectory) onNavigate(node.path)
          }}
          onDoubleClick={() => { if (!isDirectory) onOpenFile(node.path) }}
        >
          <button
            type="button" tabIndex={-1} disabled={!isDirectory}
            aria-label={t(expanded ? "treeCollapse" : "treeExpand", { name: node.name })}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent disabled:invisible"
            onClick={(event) => {
              event.stopPropagation(); scrollRef.current?.focus({ preventScroll: true }); tree.setFocusPath(node.path)
              tree.toggle(node.path)
            }}
          >
            {loading ? <LoaderCircle className="size-3 animate-spin" /> : <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />}
          </button>
          <Icon className={cn("size-3.5 shrink-0", isDirectory ? "text-muted-foreground" : "text-muted-foreground/70")} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {failed && <button type="button" tabIndex={-1} className="shrink-0 text-destructive" aria-label={t("retryDirectory")} title={`${t("retryDirectory")}: ${String(state.error)}`}
            onClick={(event) => { event.stopPropagation(); void source.retry(node.path).catch(() => undefined) }}><CircleAlert className="size-3.5" /></button>}
        </div>
      })}
    </div>
  </div>
}
