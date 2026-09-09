import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

export const SessionWorkspaceToolbarContext = createContext<{
  host: HTMLElement
  kind: "terminal" | "sftp"
} | null>(null)

/** The session owns its toolbar; Dockview only supplies its position. */
export function SessionWorkspaceToolbar({ kind, children }: {
  kind: "terminal" | "sftp"
  children: ReactNode
}) {
  const target = useContext(SessionWorkspaceToolbarContext)
  return target?.kind === kind ? createPortal(children, target.host) : children
}
