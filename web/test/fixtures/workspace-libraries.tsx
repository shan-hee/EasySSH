import React, { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { getSplitPaneDragSessionId, hasSplitPaneDragSession } from "@/lib/session/split-pane-drag"
import type { SerializedDockview } from "dockview"
import { useSessionSplitWorkspace } from "@/hooks/use-session-split-workspace"
import { SessionDockview } from "@/components/tabs/session-dockview"
import { PersistentSessionContent, SessionContentSlot, useSessionContentHosts } from "@/components/tabs/session-content-host"
import { useSftpDragDropController, type RegisterSftpDragItem } from "@/components/sftp/use-sftp-drag-drop-controller"
import { useCrossSessionFileDropTarget } from "@/hooks/use-cross-session-file-drop-target"
import { SessionWorkspaceToolbar, SessionWorkspaceToolbarContext } from "@/components/tabs/session-workspace-toolbar"
import { PageLoading } from "@/components/page-loading"
import { AppLoadingScreen } from "@/components/app-loading"
import type { TerminalSession } from "@/components/terminal/types"
import "@/styles/globals.css"

const initialSessions: TerminalSession[] = ["a", "b", "c"].map(id => ({ id, serverName: id, host: "test", username: "test", status: "connected", shouldConnect: false, connectionPhase: "ready", type: "sftp", lastActivity: 0, pinned: id === "a" }))
const operations: unknown[] = []
const mounts: Record<string, number> = {}
const files = [{ name: "file.txt", type: "file" as const }, { name: "folder", type: "directory" as const }]
function DragItem({ name, register }: { name: string; register: RegisterSftpDragItem }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => register(ref.current!, name), [register, name])
  return <div ref={ref} data-file={name} style={{ padding: 12, border: "1px solid gray", margin: 4 }}>{name}</div>
}
function Body({ id, visible }: { id: string; visible: boolean }) {
  useEffect(() => { mounts[id] = (mounts[id] ?? 0) + 1 }, [id])
  const [showFiles, setShowFiles] = useState(true)
  const drag = useSftpDragDropController({ sessionId: id, currentPath: "/tmp", files,
    onRename: (oldName, newName) => operations.push({ kind: "move", id, oldName, newName }),
    onUpload: files => { operations.push({ kind: "upload", id, names: Array.from(files).map(f => f.name) }) },
  })
  const drop = useCrossSessionFileDropTarget({ sessionId: id, enabled: visible,
    onDrop: (target, data) => operations.push({ kind: "transfer", target, data }),
  })
  return <div data-split-session-id={id} aria-hidden={!visible} inert={!visible} ref={drop.fileDropRef} className="flex h-full flex-col">
    <SessionWorkspaceToolbar kind="sftp"><button data-toolbar={id} onClick={() => operations.push({ kind: "toolbar", id })}>tools-{id}</button></SessionWorkspaceToolbar>
    <SessionWorkspaceToolbar kind="terminal"><span data-nested-toolbar={id}>nested tools</span></SessionWorkspaceToolbar>
    <textarea data-draft={id} aria-label={`draft-${id}`} defaultValue={`draft-${id}`} />
    <button data-toggle-files={id} onClick={() => setShowFiles(show => !show)}>toggle editor</button>
    {showFiles && <div ref={drag.dropZoneRef} data-files={id} className="flex-1" style={{ background: drop.isCrossSessionFileDragOver || drag.isDragging ? "#cde" : "#eee" }}>
      {files.map(file => <DragItem key={file.name} name={file.name} register={drag.registerDragItem} />)}
    </div>}
  </div>
}
function Workspace({ layout, setLayout }: { layout: SerializedDockview | null; setLayout: React.Dispatch<React.SetStateAction<SerializedDockview | null>> }) {
  const [sessions, setSessions] = useState(initialSessions)
  const [active, setActive] = useState("b")
  const [preview, setPreview] = useState<string | null>(null)
  const work = useSessionSplitWorkspace({ sessions, workspaceSessions: sessions, activeSessionId: active, splitLayout: layout, setSplitLayout: setLayout,
    workspaceTab: { id: "workspace", label: "workspace" }, isActiveConfigSession: active === "home", setActiveSessionId: setActive,
  })
  const host = useSessionContentHosts(sessions.map(s => s.id))
  const toolbarHost = useSessionContentHosts(sessions.map(s => s.id))
  const { syncSplitLayout, removeSessionFromWorkspace } = work
  useEffect(() => syncSplitLayout(new Set(sessions.map(s => s.id))), [sessions, syncSplitLayout])
  const close = useCallback((id: string) => { if (sessions.find(s => s.id === id)?.pinned) return; removeSessionFromWorkspace(id); setSessions(xs => xs.filter(s => s.id !== id)); setActive(sessions.find(s => s.id !== id)?.id ?? "home") }, [sessions, removeSessionFromWorkspace])
  useLayoutEffect(() => { Object.assign(window, { workspaceAudit: { work, active, sessions, operations, mounts, setActive, close, setPreview } }) }, [work, active, sessions, close])
  return <>
    <div><button id="ordinary-plus" onDragOver={event => { if (hasSplitPaneDragSession(event.dataTransfer)) event.preventDefault() }} onDrop={event => {
      const id = getSplitPaneDragSessionId(event.dataTransfer)
      if (id) { event.preventDefault(); work.handleRestoreDetachedSession(id) }
    }}>+</button><button onClick={() => setActive("home")}>home</button>{sessions.map(s => <button key={s.id} onClick={() => setActive(s.id)}>{s.id}</button>)}</div>
    <div ref={work.workspaceDropRef} style={{ width: 1000, height: 500, position: "relative" }}>
      {sessions.filter(s => !work.workspaceSessionIdSet.has(s.id)).map(s => <div key={s.id} style={{ position: "absolute", inset: 0, visibility: active === s.id ? "visible" : "hidden" }}><SessionContentSlot host={host(s.id)} /></div>)}
      <div aria-hidden={!work.isWorkspaceActive} inert={!work.isWorkspaceActive} style={{ position: "absolute", inset: 0, visibility: work.isWorkspaceActive ? "visible" : "hidden" }}>
        <SessionDockview canAcceptCrossSessionFileDrop={() => true} onCrossSessionFileDrop={(target, data) => operations.push({kind: "transfer", target, data})} controller={work.dockview} sessions={sessions.filter(s => work.workspaceSessionIdSet.has(s.id))} renderLeaf={id => <SessionContentSlot host={host(id)} />} renderToolbar={id => <SessionContentSlot host={toolbarHost(id)} />} dropTargetId={preview} dropSide="right" onDetach={work.handleRestoreDetachedSession} onClose={close} />
      </div>
    </div>
    {sessions.map(s => <PersistentSessionContent key={s.id} host={host(s.id)}><SessionWorkspaceToolbarContext value={work.workspaceSessionIdSet.has(s.id) ? { host: toolbarHost(s.id), kind: "sftp" } : null}><Body id={s.id} visible={work.visibleSessionIdSet.has(s.id)} /></SessionWorkspaceToolbarContext></PersistentSessionContent>)}
  </>
}
function App() {
  const [layout, setLayout] = useState<SerializedDockview | null>(null)
  const [show, setShow] = useState(true)
  return <><button id="toggle" onClick={() => setShow(s => !s)}>toggle route</button>{show && <Workspace layout={layout} setLayout={setLayout} />}<div id="page-loader"><PageLoading delay={0} label="加载服务器列表..." /></div><div id="system-loader"><AppLoadingScreen delay={0} className="min-h-16" /></div></>
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
