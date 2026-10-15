import type { PropsWithChildren } from "react"

export function ViewportWorkspaceTransition({ children }: PropsWithChildren) {
  return (
    // Keep the workspace visible by default; entry animation must not leave it at opacity: 0.
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden animate-overlay-content-in [animation-duration:var(--motion-duration-page)] motion-reduce:animate-none"
    >
      {children}
    </div>
  )
}
