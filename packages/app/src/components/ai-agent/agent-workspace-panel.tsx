import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, CircleAlert, CircleCheck, CirclePause, CircleSlash, CircleX, Clock3, Copy, Download, FileCode2, PanelRight, Server, SquareTerminal, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"
import { math } from "@streamdown/math"
import { mermaid } from "@/components/assistant-ui/elements/lazy-mermaid"
import { formatToolDuration } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/sonner"
import { PageLoading } from "@/components/page-loading"
import { getAITaskFile } from "@/lib/api/ai-agent"
import type { Server as ManagedServer } from "@/lib/api"
import type { AgentFileArtifact, AgentSessionScope, MessageView, TaskView } from "@/lib/ai-agent-types"
import { getServerDisplayName } from "@/lib/server-utils"
import { cn } from "@/lib/utils"
import { formatBytesString } from "@/lib/format-utils"
import { useSessionDraftState } from "@/hooks/use-agent-composer-draft"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"

const Editor = lazy(() => import("@/components/sftp/local-monaco-editor"))
const DiffEditor = lazy(() => import("@/components/sftp/local-monaco-editor").then((module) => ({ default: module.DiffEditor })))
const markdownPlugins = { cjk, math, mermaid }

export const isWorkspaceTask = (task: TaskView) => Boolean(task.file) || task.tool_name === "execute_command"
export const isTaskBusy = (task: TaskView) => task.status === "queued" || task.status === "running" || task.status === "waiting_confirm"

type Workspace = {
  sessionId: string | null
  tasks: TaskView[]
  serverName: (serverId: string) => string
  open: boolean
  selectedId: string | null
  select: (taskId?: string) => void
  toggle: () => void
  close: () => void
  active: boolean
  loadFile: typeof getAITaskFile
  saveFile?: (sessionId: string, taskId: string) => Promise<void>
}
const Context = createContext<Workspace | null>(null)

/** 本会话的命令与文件记录。面板只在用户打开时显示，命令输出已在消息卡片中实时展示。 */
export function AgentWorkspaceProvider({ sessionId, tasks, servers, messages, scope, active = true, loadFile = getAITaskFile, saveFile, children }: {
  sessionId: string | null
  tasks: TaskView[]
  servers?: ManagedServer[]
  messages?: MessageView[]
  scope?: AgentSessionScope
  active?: boolean
  loadFile?: typeof getAITaskFile
  saveFile?: Workspace["saveFile"]
  children: ReactNode
}) {
  const items = useMemo(() => tasks.filter(isWorkspaceTask).sort((a, b) => a.created_at.localeCompare(b.created_at)), [tasks])
  // 工具参数只有 server_id；名称来自已加载的服务器、会话范围和 @ 引用。
  const serverNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const server of servers ?? []) names.set(server.id, getServerDisplayName(server))
    if (scope?.server_id) names.set(scope.server_id, scope.server_name || scope.host || scope.server_id)
    for (const message of messages ?? []) {
      for (const reference of message.server_references ?? []) names.set(reference.server_id, reference.name || reference.host)
    }
    return names
  }, [messages, scope, servers])
  const serverName = useCallback((id: string) => serverNames.get(id) ?? id.slice(0, 8), [serverNames])
  const [selection, setSelection] = useSessionDraftState<{ open: boolean; taskId: string | null }>(sessionId, { open: false, taskId: null })
  const select = useCallback((taskId?: string) => setSelection({ open: true, taskId: taskId ?? null }), [setSelection])
  const toggle = useCallback(() => setSelection((current) => ({ ...current, open: !current.open })), [setSelection])
  const close = useCallback(() => setSelection((current) => ({ ...current, open: false })), [setSelection])
  const value = useMemo(() => ({ sessionId, tasks: items, serverName, open: selection.open, selectedId: selection.taskId, select, toggle, close, active, loadFile, saveFile }), [sessionId, items, serverName, selection, select, toggle, close, active, loadFile, saveFile])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function taskServerId(task: TaskView) {
  return task.file?.server_id ?? (typeof task.arguments?.server_id === "string" ? task.arguments.server_id : "")
}

export function useAgentWorkspace() {
  return useContext(Context)
}

/** execute_command 的结果为"标题:\n{JSON}"；未执行或取消时只有文本。 */
export function commandResult(task: TaskView): { output: string; exitCode?: number; durationMs?: number; note: string } {
  const result = task.result ?? ""
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(result.slice(result.indexOf("{"))) as Record<string, unknown>
  } catch { /* Textual status. */ }
  const output = task.command_output || (typeof data?.output === "string" ? data.output : "")
  const note = data ? (typeof data.error === "string" ? data.error : "") : task.status === "succeeded" ? "" : task.error || result
  return {
    output,
    exitCode: typeof data?.exit_code === "number" ? data.exit_code : undefined,
    durationMs: typeof data?.duration_ms === "number" ? data.duration_ms : undefined,
    note,
  }
}

const statusIcons = {
  queued: Clock3,
  waiting_confirm: CirclePause,
  succeeded: CircleCheck,
  failed: CircleX,
  unknown: CircleAlert,
  cancelled: CircleSlash,
} as const

export function TaskStatusBadge({ task, className }: { task: TaskView; className?: string }) {
  const { t } = useTranslation("aiAssistant")
  const exitCode = task.file ? undefined : commandResult(task).exitCode
  const Icon = task.status === "running" ? Spinner : statusIcons[task.status]
  const label = exitCode !== undefined && (task.status === "succeeded" || task.status === "failed")
    ? t("workspaceExitCode", { code: exitCode })
    : t(`workspaceStatus_${task.status}`)
  return <span data-status={task.status} className={cn(
    "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground",
    task.status === "running" && "text-primary",
    task.status === "succeeded" && "text-status-connected",
    task.status === "failed" && "text-destructive",
    (task.status === "waiting_confirm" || task.status === "unknown") && "text-amber-700 dark:text-amber-400",
    className,
  )}>
    <Icon aria-hidden className="size-3.5" />{label}
  </span>
}

export function CopyIconButton({ value, tooltip, className }: { value: string; tooltip: string; className?: string }) {
  const { t } = useTranslation("aiAssistant")
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  return <TooltipIconButton type="button" tooltip={isCopied ? t("copied") : tooltip} className={cn("size-7 shrink-0 text-muted-foreground", className)}
    onClick={() => { void copyToClipboard(value).catch(() => toast.error(t("workspaceCopyFailed"))) }}>
    {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
  </TooltipIconButton>
}

/** 命令输出：到底部时跟随新内容，向上滚动后停止跟随。 */
export function CommandOutput({ task, className, viewportClassName }: { task: TaskView; className?: string; viewportClassName?: string }) {
  const { t } = useTranslation("aiAssistant")
  const viewport = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const { output } = commandResult(task)
  useEffect(() => { if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight }, [follow, output])
  return <div className={cn("relative min-w-0", className)}>
    <div ref={viewport} onScroll={(event) => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40) }}
      className={cn("overflow-auto bg-muted/40 px-3 py-2.5 font-mono text-xs leading-5", viewportClassName)}>
      {output
        ? <pre className="whitespace-pre-wrap break-words">{output}</pre>
        : <p className="text-muted-foreground">{t(task.status === "queued" ? "workspaceQueuedOutput" : task.status === "running" ? "workspaceWaitingOutput" : "workspaceNoOutput")}</p>}
    </div>
    {!follow && <Button type="button" variant="secondary" size="sm" className="absolute bottom-2 end-3 h-6 gap-1 px-2 text-xs" onClick={() => setFollow(true)}><ChevronDown className="size-3" />{t("workspaceFollowOutput")}</Button>}
  </div>
}

export function AgentWorkspaceToggle() {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  if (!workspace || workspace.tasks.length === 0) return null
  const running = workspace.tasks.filter(isTaskBusy).length
  return <Button type="button" variant="ghost" size="sm" aria-pressed={workspace.open} className={cn("h-8 min-w-0 gap-1.5 px-2.5 text-xs text-muted-foreground", workspace.open && "bg-accent text-foreground")} onClick={workspace.toggle}>
    {running ? <Spinner className="size-3.5" /> : <PanelRight className="size-3.5" />}
    <span className="truncate">{t("workspaceTitle")}</span>
    <span className="tabular-nums">{running ? t("workspaceActiveCount", { count: running }) : workspace.tasks.length}</span>
  </Button>
}

/** 消息中文件类工具的预览入口。 */
export function AgentWorkspaceFileLink({ task }: { task: TaskView }) {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  if (!workspace || !task.file) return null
  return <button type="button" onClick={() => workspace.select(task.id)} className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 text-left text-sm hover:bg-accent">
    <FileCode2 className="size-4 shrink-0 text-primary" />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={task.file.path}>{task.file.name}</span><span className="text-xs text-muted-foreground">{t(task.file.kind === "modified" ? "workspaceOpenDiff" : "workspaceOpenFile")}</span></span>
    <PanelRight className="size-4 shrink-0 text-muted-foreground" />
  </button>
}

export function AgentWorkspacePanel({ compact = false }: { compact?: boolean }) {
  const workspace = useContext(Context)
  const { t } = useTranslation("aiAssistant")
  const anchor = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(compact)
  const [width, setWidth] = useState(42)
  useEffect(() => {
    const parent = anchor.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(([entry]) => setNarrow(compact || entry.contentRect.width < 1000))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [compact])
  const open = Boolean(workspace?.active && workspace.open && workspace.tasks.length)
  const resize = (value: number) => setWidth(Math.max(30, Math.min(65, value)))
  return <>
    <div ref={anchor} className="hidden" />
    {open && !narrow && <aside style={{ width: `${width}%` }} className="@container relative flex min-h-0 min-w-[320px] shrink-0 flex-col border-l bg-background" aria-label={t("workspaceTitle")}>
      <div role="separator" aria-orientation="vertical" aria-label={t("workspaceResize")} aria-valuemin={30} aria-valuemax={65} aria-valuenow={Math.round(width)} tabIndex={0}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/15 focus-visible:bg-primary/15"
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowLeft" ? 2 : -2)) } }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = anchor.current?.parentElement?.getBoundingClientRect(); if (bounds) resize((bounds.right - event.clientX) / bounds.width * 100) }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />
      <WorkspaceContent />
    </aside>}
    <Sheet open={open && narrow} onOpenChange={(value) => { if (!value) workspace?.close() }}>
      <SheetContent side="right" showCloseButton={false} className="@container flex w-full flex-col gap-0 p-0 sm:max-w-[min(90vw,720px)]">
        <SheetTitle className="sr-only">{t("workspaceTitle")}</SheetTitle>
        <SheetDescription className="sr-only">{t("workspaceDescription")}</SheetDescription>
        <WorkspaceContent />
      </SheetContent>
    </Sheet>
  </>
}

function WorkspaceContent() {
  const workspace = useContext(Context)!
  const { t } = useTranslation("aiAssistant")
  const { tasks } = workspace
  const selected = tasks.find((task) => task.id === workspace.selectedId) ?? tasks.at(-1)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-12 shrink-0 items-center gap-2 border-b ps-4 pe-2">
      <span className="text-sm font-medium">{t("workspaceTitle")}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
      <TooltipIconButton type="button" className="ms-auto size-7" tooltip={t("workspaceClose")} onClick={workspace.close}><X className="size-4" /></TooltipIconButton>
    </div>
    <ul className="max-h-48 shrink-0 space-y-0.5 overflow-y-auto border-b p-2">
      {tasks.map((task) => {
        const server = workspace.serverName(taskServerId(task))
        const durationMs = task.file ? undefined : commandResult(task).durationMs
        return <li key={task.id}>
          <button type="button" onClick={() => workspace.select(task.id)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent", selected?.id === task.id && "bg-accent")}>
            {task.file ? <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" /> : <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className={cn("min-w-0 flex-1 truncate", !task.file && "font-mono")} title={task.file?.path ?? String(task.arguments?.command ?? "")}>{task.file?.name ?? String(task.arguments?.command ?? task.tool_name)}</span>
            {server && <span className="hidden max-w-28 shrink-0 truncate text-muted-foreground @min-[26rem]:inline">{server}</span>}
            {durationMs !== undefined && <span className="shrink-0 tabular-nums text-muted-foreground">{formatToolDuration(durationMs)}</span>}
            <TaskStatusBadge task={task} />
          </button>
        </li>
      })}
    </ul>
    {selected && (selected.file
      ? <FileDetail key={`${workspace.sessionId}:${selected.id}`} task={selected} />
      : <CommandDetail key={`${workspace.sessionId}:${selected.id}`} task={selected} />)}
  </div>
}

function CommandDetail({ task }: { task: TaskView }) {
  const workspace = useContext(Context)!
  const { t } = useTranslation("aiAssistant")
  const command = String(task.arguments?.command ?? "")
  const result = commandResult(task)
  const server = workspace.serverName(taskServerId(task))
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b px-4 py-3">
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-5"><span className="select-none text-muted-foreground">$ </span>{command}</pre>
        <CopyIconButton value={command} tooltip={t("commandCopy")} className="-my-1" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <TaskStatusBadge task={task} />
        {server && <span className="inline-flex min-w-0 items-center gap-1"><Server className="size-3 shrink-0" /><span className="truncate">{server}</span></span>}
        {result.durationMs !== undefined && <span className="tabular-nums">{formatToolDuration(result.durationMs)}</span>}
        <time dateTime={task.created_at}>{new Date(task.created_at).toLocaleString()}</time>
      </div>
      {result.note && <p role="alert" className="break-words text-xs text-destructive">{result.note}</p>}
    </div>
    {task.status === "waiting_confirm"
      ? <p className="p-4 text-xs text-muted-foreground">{t("workspaceWaitingApproval")}</p>
      : <div className="flex min-h-0 flex-1 flex-col">
        <CommandOutput task={task} className="flex min-h-0 flex-1 flex-col" viewportClassName="min-h-0 flex-1 bg-muted/25 px-4" />
        {result.output && <div className="flex shrink-0 justify-end border-t px-2 py-1"><CopyIconButton value={result.output} tooltip={t("commandCopyOutput")} /></div>}
      </div>}
  </div>
}

function FileDetail({ task }: { task: TaskView }) {
  const workspace = useContext(Context)!
  const { t } = useTranslation("aiAssistant")
  const server = workspace.serverName(taskServerId(task))
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-1 border-b px-4 py-3">
      <div className="truncate text-sm font-medium" title={task.file?.path}>{task.file?.path ?? task.file?.name}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <TaskStatusBadge task={task} />
        <span className="inline-flex min-w-0 items-center gap-1"><Server className="size-3 shrink-0" /><span className="truncate">{server || t("workspaceSessionFile")}</span></span>
        {task.file && <span>{formatBytesString(task.file.size)}</span>}
      </div>
      {task.file?.kind === "modified" && <p className="text-xs text-muted-foreground">{t(task.status === "succeeded" ? "workspaceAppliedSnapshot" : "workspaceProposedSnapshot")}</p>}
      {task.error && <p role="alert" className="break-words text-xs text-destructive">{task.error}</p>}
    </div>
    <FilePreview task={task} />
  </div>
}

function FilePreview({ task }: { task: TaskView }) {
  const workspace = useContext(Context)!
  const { sessionId, loadFile } = workspace
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
    if (!sessionId) return
    setFile(null); setError("")
    loadFile(sessionId, task.id).then((value) => { if (!cancelled) { setFile(value); setTab(value.before !== undefined ? "diff" : "preview") } }).catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [loadFile, sessionId, task.id, retry])
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
  if (!file) return <PageLoading className="min-h-0" />
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
      <Button size="icon" variant="ghost" className="size-7" disabled={saving} aria-label={t("workspaceDownload")} title={t("workspaceDownload")} onClick={() => void download()}>{saving ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}</Button>
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
