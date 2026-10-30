import { Fragment, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Files, SquareArrowOutUpRight, Terminal, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { SessionDockviewController } from "@/hooks/use-session-split-workspace"
import type { TerminalSession } from "@/components/terminal/types"
import { useCrossSessionFileDropTarget } from "@/hooks/use-cross-session-file-drop-target"
import type { CrossSessionFileDragData } from "@/lib/session/cross-session-file-drag"
import { SessionSplitDropOverlay } from "./session-split-drop-overlay"
import type { SessionTabDropSide } from "./session-tab-bar"
import { cn } from "@/lib/utils"
import "dockview/dist/styles/dockview.css"
import "./session-dockview.css"

interface FileDropProps {
  canAcceptCrossSessionFileDrop?: (session: TerminalSession) => boolean
  onCrossSessionFileDrop?: (id: string, data: CrossSessionFileDragData) => void
}

export function SessionDockview({ controller, sessions, renderLeaf, renderToolbar, dropTargetId, dropSide, onDetach, onClose, canAcceptCrossSessionFileDrop, onCrossSessionFileDrop }: FileDropProps & {
  controller: SessionDockviewController
  sessions: TerminalSession[]
  renderLeaf: (id: string) => ReactNode
  renderToolbar?: (id: string) => ReactNode
  dropTargetId?: string | null
  dropSide?: SessionTabDropSide | null
  onDetach: (id: string) => void
  onClose: (id: string) => void
}) {
  const slot = useRef<HTMLDivElement>(null)
  const { t } = useTranslation("terminal")
  const closeFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return
    const id = target.querySelector<HTMLElement>("[data-dockview-session-id]")?.dataset.dockviewSessionId
    const session = sessions.find(session => session.id === id)
    if (!session) return
    event.preventDefault()
    event.stopPropagation()
    if (!session.pinned) onClose(session.id)
  })
  useLayoutEffect(() => {
    const target = slot.current!
    target.appendChild(controller.element)
    const onKeyDown = (event: KeyboardEvent) => closeFromKeyboard(event)
    controller.element.addEventListener("keydown", onKeyDown, true)
    return () => {
      controller.element.removeEventListener("keydown", onKeyDown, true)
      if (controller.element.parentNode === target) controller.element.remove()
    }
  }, [controller])
  return <>
    <div ref={slot} className="h-full min-h-0 min-w-0 flex-1" data-session-dockview />
    {controller.api?.groups.map(group => {
      const id = group.activePanel?.id
      const actions = controller.actions.get(group.id)
      const session = sessions.find(session => session.id === id)
      return <Fragment key={group.id}>
        {session && actions && createPortal(
          <div className="flex h-full min-w-0 items-center">
            <div className="h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              {renderToolbar?.(session.id)}
            </div>
            {!session.pinned && <button
              type="button"
              className="mx-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label={t("ariaCloseSplitPaneSession")}
              title={t("ariaCloseSplitPaneSession")}
              onPointerDown={event => event.stopPropagation()}
              onMouseDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); onClose(session.id) }}
            ><X className="size-3.5" /></button>}
          </div>, actions)}
        {id && createPortal(<SessionSplitDropOverlay side={id === dropTargetId ? dropSide ?? null : null} />, group.element)}
      </Fragment>
    })}
    {sessions.map(session => {
      const content = controller.contents.get(session.id)
      const tab = controller.tabs.get(session.id)
      return <Fragment key={session.id}>
        {content && createPortal(renderLeaf(session.id), content)}
        {tab && createPortal(<SessionDockviewTab session={session} onDetach={onDetach}
          canAcceptCrossSessionFileDrop={canAcceptCrossSessionFileDrop} onCrossSessionFileDrop={onCrossSessionFileDrop} />, tab)}
      </Fragment>
    })}
  </>
}

function SessionDockviewTab({ session, onDetach, canAcceptCrossSessionFileDrop, onCrossSessionFileDrop }: FileDropProps & {
  session: TerminalSession
  onDetach: (id: string) => void
}) {
  const { t } = useTranslation("terminal")
  const Icon = session.type === "sftp" ? Files : Terminal
  const { fileDropRef, isCrossSessionFileDragOver } = useCrossSessionFileDropTarget({
    sessionId: session.id, enabled: canAcceptCrossSessionFileDrop?.(session) ?? false, onDrop: onCrossSessionFileDrop,
  })
  return <div ref={fileDropRef} data-dockview-session-id={session.id}
    className={cn("flex h-full min-w-0 cursor-grab items-center gap-2 px-2 text-xs active:cursor-grabbing", isCrossSessionFileDragOver && "bg-primary/10 ring-1 ring-inset ring-primary/60")}
    title={`${session.serverName} · ${session.type === "sftp" ? "SFTP" : "SSH"} · ${session.username}@${session.host}`}>
    <span className={cn("size-1.5 shrink-0 rounded-full", session.status === "connected" ? "bg-green-500" : session.status === "reconnecting" ? "bg-yellow-500" : "bg-red-500")} />
    <Icon className="size-3 shrink-0" />
    <span className="max-w-40 truncate">{session.serverName}</span>
    <button type="button" className="rounded p-1 hover:bg-accent" aria-label={t("detachWorkspaceSession")} title={t("detachWorkspaceSession")}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onDetach(session.id) }}><SquareArrowOutUpRight className="size-3" /></button>
  </div>
}
