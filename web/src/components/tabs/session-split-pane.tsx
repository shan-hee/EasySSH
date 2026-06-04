import type { CSSProperties, ReactNode } from "react"
import type { SessionStatus } from "@/components/terminal/types"
import { setSplitPaneDragSessionId } from "@/lib/session/split-pane-drag"
import { cn } from "@/lib/utils"

export interface SessionSplitPaneHeaderBackground {
  color?: string
  image?: string
  imageOpacity?: number
}

interface SessionSplitPaneProps {
  sessionId: string
  title: string
  subtitle?: string
  status?: SessionStatus
  isActive?: boolean
  background?: SessionSplitPaneHeaderBackground
  dropOverlay?: ReactNode
  children: ReactNode
  onFocus?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

const createPaneDragPreview = ({
  title,
  status,
}: {
  title: string
  status?: SessionStatus
}) => {
  const preview = document.createElement("div")
  preview.className = "pointer-events-none fixed left-0 top-0 z-[9999] flex h-8 items-center gap-2 rounded-lg border border-border bg-card/90 pl-3 pr-8 text-foreground shadow-2xl backdrop-blur-sm"
  preview.style.transform = "translate(-10000px, -10000px)"
  preview.style.maxWidth = "180px"

  const statusDot = document.createElement("span")
  statusDot.className = `h-1.5 w-1.5 shrink-0 rounded-full ${getStatusClassName(status)}`
  preview.appendChild(statusDot)

  const label = document.createElement("span")
  label.className = "max-w-32 truncate text-xs font-medium text-foreground"
  label.textContent = title
  preview.appendChild(label)

  document.body.appendChild(preview)
  return preview
}

const getStatusClassName = (status?: SessionStatus) => {
  if (status === "connected") return "bg-green-500"
  if (status === "reconnecting") return "bg-yellow-500 animate-pulse"
  return "bg-red-500"
}

export function SessionSplitPane({
  sessionId,
  title,
  subtitle,
  status,
  isActive = false,
  background,
  dropOverlay,
  children,
  onFocus,
  onDragStart,
  onDragEnd,
}: SessionSplitPaneProps) {
  const backgroundColorStyle: CSSProperties | undefined = background?.color
    ? { backgroundColor: background.color }
    : undefined
  const backgroundImageStyle: CSSProperties | undefined = background?.image
    ? {
        backgroundImage: `url(${background.image})`,
        opacity: background.imageOpacity ?? 1,
      }
    : undefined

  return (
    <div
      data-split-session-id={sessionId}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border transition-colors",
        isActive
          ? "z-10 border-transparent"
          : "border-border/55"
      )}
      onMouseDown={onFocus}
    >
      {background ? (
        <>
          <div aria-hidden="true" className="absolute inset-0" style={backgroundColorStyle} />
          {backgroundImageStyle && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={backgroundImageStyle}
            />
          )}
        </>
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-background/70" />
      )}
      {dropOverlay}
      <div
        draggable
        className={cn(
          "relative flex h-7 shrink-0 cursor-grab items-center overflow-hidden px-2.5 text-xs text-muted-foreground active:cursor-grabbing",
          !background && "bg-card/45 backdrop-blur-md"
        )}
        onDragStart={(event) => {
          event.stopPropagation()
          setSplitPaneDragSessionId(event.dataTransfer, sessionId)
          onDragStart?.()
          const preview = createPaneDragPreview({ title, status })
          event.dataTransfer.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2)
          window.setTimeout(() => preview.remove(), 0)
          event.dataTransfer.dropEffect = "move"
        }}
        onDragEnd={(event) => {
          event.stopPropagation()
          onDragEnd?.()
        }}
      >
        <span className="relative z-10 flex min-w-0 items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", getStatusClassName(status))} />
          <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
          {subtitle && (
            <span className="min-w-0 shrink truncate font-mono text-[10px] text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      {isActive && (
        <div className="pointer-events-none absolute inset-0 z-40 rounded-xl border border-primary/70" />
      )}
    </div>
  )
}
