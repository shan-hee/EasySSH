import { RelatedTask } from "./related-task"
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Copy, Download, FileCode2, Loader2, Maximize2, PanelRight, Square, Terminal, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"
import { math } from "@streamdown/math"
import { mermaid } from "@/components/assistant-ui/elements/lazy-mermaid"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { getAITaskFile } from "@/lib/api/ai-agent"
import type { AgentFileArtifact, AgentSessionScope, MessageView, TaskView } from "@/lib/ai-agent-types"
import { cn } from "@/lib/utils"
import { formatBytesString } from "@/lib/format-utils"
import { useSessionDraftState } from "@/hooks/use-agent-composer-draft"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { PageLoading } from "@/components/page-loading"

const Editor = lazy(() => import("@/components/sftp/local-monaco-editor"))
const DiffEditor = lazy(() => import("@/components/sftp/local-monaco-editor").then((module) => ({ default: module.DiffEditor })))
const markdownPlugins = { cjk, math, mermaid }
const isBusy = (task: TaskView) => ["queued", "running", "waiting_confirm"].includes(task.status)
const taskFollowKey = (sessionId: string, task: TaskView) => `${sessionId}:${task.id}:${task.status}:${Boolean(task.file)}`

type Selection = { open: boolean; taskId: string | null; follow: boolean; dismissed: boolean }
type Workspace = {
  sessionId: string | null
  tasks: TaskView[]
  serverNames: Map<string, string>
  selection: Selection
  select: (taskId?: string) => void
  close: () => void
  active: boolean
  loadFile: typeof getAITaskFile
  saveFile?: (sessionId: string, taskId: string) => Promise<void>
  approve: (id: string, approved: boolean) => Promise<void>
  stop: () => void | Promise<void>
}
const Context = createContext<Workspace | null>(null)

export function AgentWorkspaceProvider({ sessionId, tasks, messages, scope, active = true, loadFile = getAITaskFile, saveFile, approve, stop, children }: {
  sessionId: string | null
  tasks: TaskView[]
  messages?: MessageView[]
  scope?: AgentSessionScope
  active?: boolean
  loadFile?: typeof getAITaskFile
  saveFile?: Workspace["saveFile"]
  approve: Workspace["approve"]
  stop: Workspace["stop"]
  children: ReactNode
}) {
  const items = useMemo(() => tasks.filter((task) => task.file || task.tool_name === "execute_command").sort((a, b) => a.created_at.localeCompare(b.created_at)), [tasks])
  const serverNames = useMemo(() => {
    const names = new Map<string, string>()
    if (scope?.server_id) names.set(scope.server_id, scope.server_name || scope.host || scope.server_id)
    for (const message of messages ?? []) {
      for (const reference of message.server_references ?? []) names.set(reference.server_id, reference.name || reference.host)
    }
    return names
  }, [messages, scope])
  const [selection, setSelection] = useSessionDraftState<Selection>(sessionId, { open: false, taskId: null, follow: true, dismissed: false })
  const seen = useRef(new Set<string>())
  const initialized = useRef(new Set<string>())
  useEffect(() => {
    if (!active || !sessionId) return
    const firstVisit = !initialized.current.has(sessionId)
    initialized.current.add(sessionId)
    const unseen = items.filter((task) => !seen.current.has(taskFollowKey(sessionId, task)))
    for (const task of items) seen.current.add(taskFollowKey(sessionId, task))
    const latest = unseen.filter((task) => task.file?.kind !== "read" && (!firstVisit || isBusy(task))).at(-1)
    if (!latest) return
    setSelection((current) => current.dismissed || !current.follow ? current : { ...current, open: true, taskId: latest.id })
  }, [active, items, sessionId, setSelection])
  const select = useCallback((taskId?: string) => {
    setSelection((current) => ({ ...current, open: true, dismissed: false, follow: !taskId, taskId: taskId ?? items.at(-1)?.id ?? null }))
  }, [items, setSelection])
  const close = useCallback(() => setSelection((current) => ({ ...current, open: false, dismissed: true })), [setSelection])
  const value = useMemo(() => ({ sessionId, tasks: items, serverNames, selection, select, close, active, loadFile, saveFile, approve, stop }), [sessionId, items, serverNames, selection, select, close, active, loadFile, saveFile, approve, stop])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function AgentWorkspaceToolLink({ taskId, toolCallId }: { taskId: string; toolCallId?: string }) {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  const task = workspace?.tasks.find((item) => item.id === taskId || item.tool_call_id === toolCallId)
  if (!task || !workspace) return null
  return <button type="button" onClick={() => workspace.select(task.id)} className="my-2 flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-left text-sm hover:bg-accent">
    {task.file ? <FileCode2 className="size-4 shrink-0 text-primary" /> : <Terminal className="size-4 shrink-0 text-primary" />}
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{task.file?.name ?? String(task.arguments?.command ?? t("workspaceCommands"))}</span><span className="text-xs text-muted-foreground">{t(task.file?.kind === "modified" ? "workspaceOpenDiff" : task.file ? "workspaceOpenFile" : "workspaceLiveOutput")}</span></span>
    <PanelRight className="size-4 shrink-0 text-muted-foreground" />
  </button>
}

export function AgentWorkspaceToolbar() {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  if (!workspace || workspace.tasks.length === 0) return null
  const running = workspace.tasks.filter(isBusy)
  return <Button type="button" variant="ghost" size="sm" className="h-8 min-w-0 gap-2 text-xs text-muted-foreground" onClick={() => workspace.select()}>
    {running.length ? <Loader2 className="size-3.5 animate-spin" /> : <PanelRight className="size-3.5" />}
    <span className="truncate">{t("workspaceTitle")}</span>
    <span className="tabular-nums">{running.length ? t("workspaceActiveCount", { count: running.length }) : workspace.tasks.length}</span>
  </Button>
}

export function AgentWorkspacePanel({ compact = false }: { compact?: boolean }) {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  const anchor = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(compact)
  const [expanded, setExpanded] = useState(false)
  const [width, setWidth] = useState(45)
  useEffect(() => {
    const parent = anchor.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(([entry]) => setNarrow(compact || entry.contentRect.width < 1000))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [compact])
  const open = Boolean(workspace?.active && workspace.selection.open && workspace.tasks.length)
  const overlay = narrow || expanded
  return <>
    <div ref={anchor} className="hidden" />
    {open && !overlay && <aside style={{ width: `${width}%` }} className="relative flex min-h-0 min-w-[320px] shrink-0 flex-col border-l bg-background" aria-label={t("workspaceTitle")}>
      <div role="separator" aria-orientation="vertical" aria-label={t("workspaceResize")} aria-valuemin={30} aria-valuemax={65} aria-valuenow={Math.round(width)} tabIndex={0}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/15 focus-visible:bg-primary/15"
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth((value) => Math.max(30, Math.min(65, value + (event.key === "ArrowLeft" ? 2 : -2)))) } }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = anchor.current?.parentElement?.getBoundingClientRect(); if (bounds) setWidth(Math.max(30, Math.min(65, (bounds.right - event.clientX) / bounds.width * 100))) }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />
      <WorkspaceContent onExpand={() => setExpanded(true)} />
    </aside>}
    <Sheet open={open && overlay} onOpenChange={(value) => { if (!value) { workspace?.close(); setExpanded(false) } }}>
      <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(90vw,1100px)]">
        <SheetTitle className="sr-only">{t("workspaceTitle")}</SheetTitle>
        <SheetDescription className="sr-only">{t("workspaceDescription")}</SheetDescription>
        <WorkspaceContent />
      </SheetContent>
    </Sheet>
  </>
}

function fileIdentity(task: TaskView) {
  return task.file ? `${task.file.server_id ?? ""}:${task.file.path ?? task.file.name}` : task.id
}

function WorkspaceContent({ onExpand }: { onExpand?: () => void }) {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  const versions = useMemo(() => {
    const counts = new Map<string, number>()
    const result = new Map<string, number>()
    for (const task of workspace?.tasks ?? []) {
      if (!task.file || task.file.kind === "read") continue
      const identity = fileIdentity(task)
      const version = (counts.get(identity) ?? 0) + 1
      counts.set(identity, version)
      result.set(task.id, version)
    }
    return result
  }, [workspace?.tasks])
  if (!workspace) return null
  const { tasks, selection } = workspace
  const selected = tasks.find((task) => task.id === selection.taskId) ?? tasks.at(-1)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <PanelRight className="size-4 text-muted-foreground" /><span className="flex-1 text-sm font-medium">{t("workspaceTitle")}</span>
      {!selection.follow && <Button size="icon" variant="ghost" className="size-7" title={t("workspaceFollowTasks")} aria-label={t("workspaceFollowTasks")} onClick={() => workspace.select()}><ChevronDown className="size-3.5" /></Button>}
      {onExpand && <Button size="icon" variant="ghost" className="size-7" title={t("workspaceExpand")} aria-label={t("workspaceExpand")} onClick={onExpand}><Maximize2 className="size-3.5" /></Button>}
      <Button size="icon" variant="ghost" className="size-7" title={t("workspaceClose")} aria-label={t("workspaceClose")} onClick={workspace.close}><X className="size-4" /></Button>
    </div>
    <div className="max-h-44 shrink-0 overflow-y-auto border-b p-2">
      {tasks.map((task) => <button key={task.id} type="button" onClick={() => workspace.select(task.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent", selected?.id === task.id && "bg-accent")}>
        {task.status === "running" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : task.file ? <FileCode2 className="size-3.5 shrink-0" /> : <Terminal className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate" title={task.file?.path ?? String(task.arguments?.command ?? "")}>{task.file?.name ?? String(task.arguments?.command ?? task.tool_name)}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{task.file?.kind === "read" ? t("workspaceReadSnapshot") : versions.has(task.id) ? `v${versions.get(task.id)}` : ""}</span>
        <span className={cn("shrink-0 text-[10px] text-muted-foreground", task.status === "failed" && "text-destructive")}>{t(`workspaceStatus_${task.status}`)}</span>
      </button>)}
    </div>
    {selected && <TaskDetail key={`${workspace.sessionId}:${selected.id}`} task={selected} />}
  </div>
}

function TaskDetail({ task }: { task: TaskView }) {
  const workspace = useContext(Context)!
  const { t } = useTranslation("aiAssistant")
  const [busy, setBusy] = useState(false)
  const serverID = task.file?.server_id ?? String(task.arguments?.server_id ?? "")
  const target = workspace.serverNames.get(serverID) || String(task.arguments?.server_name || serverID || t("workspaceSessionFile"))
  const decide = async (approved: boolean) => {
    setBusy(true)
    try { await workspace.approve(task.id, approved) } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-1 border-b px-4 py-3">
      <div className="truncate text-sm font-medium" title={task.file?.path}>{task.file?.path ?? task.file?.name ?? t("workspaceCommands")}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span title={serverID}>{target}</span><span>·</span><time>{new Date(task.created_at).toLocaleString()}</time>{task.file && <><span>·</span><span>{formatBytesString(task.file.size)}</span></>}</div>
      {task.file?.kind === "modified" && <p className="text-xs text-muted-foreground">{t(task.status === "succeeded" ? "workspaceAppliedSnapshot" : "workspaceProposedSnapshot")}</p>}
      <RelatedTask result={task.result} />
      {task.error && <p role="alert" className="break-words text-xs text-destructive">{task.error}</p>}
    </div>
    {task.file ? <FilePreview task={task} /> : <CommandPreview task={task} />}
    {task.status === "waiting_confirm" && <div className="flex shrink-0 items-center justify-end gap-2 border-t p-3">
      <span className="mr-auto text-xs text-muted-foreground">{t("workspaceApprovalHint")}</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(false)}>{t("workspaceReject")}</Button>
      <Button size="sm" disabled={busy} onClick={() => void decide(true)}>{busy && <Loader2 className="size-3.5 animate-spin" />}{t("workspaceApprove")}</Button>
    </div>}
    {task.status === "running" && <div className="flex shrink-0 justify-end border-t p-2"><Button size="sm" variant="ghost" onClick={() => { void Promise.resolve().then(workspace.stop).catch(() => toast.error(t("workspaceStopFailed"))) }}><Square className="size-3" />{t("workspaceStopRun")}</Button></div>}
  </div>
}

function commandResult(task: TaskView): { output: string; exitCode?: number; duration?: number } {
  const result = task.result ?? ""
  try {
    const data = JSON.parse(result.slice(result.indexOf("{"))) as Record<string, unknown>
    if (typeof data.output === "string") return { output: data.output, exitCode: typeof data.exit_code === "number" ? data.exit_code : undefined, duration: typeof data.duration_ms === "number" ? data.duration_ms : undefined }
  } catch { /* A cancelled command may only have a textual status. */ }
  return { output: task.command_output || result }
}

function CommandPreview({ task }: { task: TaskView }) {
  const { t } = useTranslation("aiAssistant")
  const viewport = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const result = commandResult(task)
  useEffect(() => { if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight }, [follow, result.output])
  return <>
    <div className="shrink-0 border-b bg-muted/30 px-4 py-3"><code className="whitespace-pre-wrap break-all text-xs">$ {String(task.arguments?.command ?? "")}</code></div>
    <div ref={viewport} onScroll={(event) => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40) }} className="min-h-0 flex-1 overflow-auto bg-muted/15 p-4 font-mono text-xs leading-6">
      <pre className="whitespace-pre-wrap break-words">{result.output || t(task.status === "waiting_confirm" ? "workspaceWaitingApproval" : task.status === "queued" ? "workspaceQueuedOutput" : task.status === "running" ? "workspaceWaitingOutput" : "workspaceNoOutput")}</pre>
    </div>
    <div className="flex shrink-0 items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      {result.exitCode !== undefined && <span>{t("workspaceExitCode", { code: result.exitCode })}</span>}
      {result.duration !== undefined && <span>{(result.duration / 1000).toFixed(1)} s</span>}
      {!follow && <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setFollow(true)}><ChevronDown className="size-3" />{t("workspaceFollowOutput")}</Button>}
    </div>
  </>
}

function FilePreview({ task }: { task: TaskView }) {
  const workspace = useContext(Context)!
  const { t } = useTranslation("aiAssistant")
  const { resolvedTheme } = useTheme()
  const [file, setFile] = useState<AgentFileArtifact | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [tab, setTab] = useState("preview")
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!workspace.sessionId) return
    setFile(null); setError("")
    workspace.loadFile(workspace.sessionId, task.id).then((value) => { if (!cancelled) { setFile(value); setTab(value.before !== undefined ? "diff" : "preview") } }).catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [workspace.loadFile, workspace.sessionId, task.id, retry])
  const download = async () => {
    if (!file || !workspace.sessionId) return
    setSaving(true)
    try {
      if (workspace.saveFile) {
        await workspace.saveFile(workspace.sessionId, task.id)
      } else {
        const body = file.encoding === "base64" ? Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)) : file.content
        const url = URL.createObjectURL(new Blob([body], { type: file.media_type }))
        const link = document.createElement("a"); link.href = url; link.download = file.name; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (reason) { toast.error(String(reason)) } finally { setSaving(false) }
  }
  const copy = async () => {
    if (!file) return
    try { await copyToClipboard(file.content) } catch { toast.error(t("workspaceCopyFailed")) }
  }
  if (error) return <div className="p-4 text-sm"><p role="alert" className="text-destructive">{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>{t("workspaceRetry")}</Button></div>
  if (!file) return <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  const image = file.encoding === "base64"
  const ext = file.name.split(".").at(-1)?.toLowerCase() ?? ""
  const markdown = ["md", "mdx", "markdown"].includes(ext)
  const html = ["html", "htm"].includes(ext)
  const language = ({ sh: "shell", bash: "shell", py: "python", js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", yml: "yaml", md: "markdown", rs: "rust", conf: "ini" } as Record<string, string>)[ext] ?? ext
  const options = { readOnly: true, domReadOnly: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: "on" as const }
  return <>
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      {(!image ? ["preview", "source", ...(file.before !== undefined ? ["diff"] : [])] : ["preview"]).map((value) => <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setTab(value)}>{t(`workspaceTab_${value}`)}</Button>)}
      <span className="flex-1" />
      {!image && <Button size="icon" variant="ghost" className="size-7" aria-label={t("workspaceCopy")} title={t("workspaceCopy")} onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>}
      <Button size="icon" variant="ghost" className="size-7" disabled={saving} aria-label={t("workspaceDownload")} title={t("workspaceDownload")} onClick={() => void download()}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}</Button>
    </div>
    <div className="min-h-0 flex-1 overflow-hidden">
      <Suspense fallback={<PageLoading className="h-full min-h-0" />}>
        {tab === "diff" && file.before !== undefined ? <DiffEditor original={file.before} modified={file.content} language={language} theme={resolvedTheme === "dark" ? "vs-dark" : "light"} options={{ ...options, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true, originalEditable: false }} />
          : image ? <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={`data:${file.media_type};base64,${file.content}`} alt={file.name} className="max-h-full max-w-full object-contain" /></div>
          : tab === "preview" && html ? <iframe title={file.name} sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">${file.content}`} className="h-full w-full border-0 bg-white" />
          : tab === "preview" && markdown ? <div className="h-full overflow-auto p-5 text-sm"><Streamdown plugins={markdownPlugins} mode="static">{file.content}</Streamdown></div>
          : <Editor value={file.content} language={language} theme={resolvedTheme === "dark" ? "vs-dark" : "light"} options={options} />}
      </Suspense>
    </div>
  </>
}
