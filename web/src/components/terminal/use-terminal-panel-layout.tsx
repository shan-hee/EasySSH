import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { useTranslation } from "react-i18next"
import type { SshWorkspacePreferenceAdapter } from "@/lib/session/workspace"
import type { TerminalPanelPosition } from "@/stores/tab-ui-store"
import { cn } from "@/lib/utils"

export type TerminalPanelKey = "monitor" | "files" | "ai"
type Axis = "width" | "height"
type Sizes = Record<TerminalPanelKey, Record<Axis, number>>
const PANEL_KEYS: TerminalPanelKey[] = ["monitor", "files", "ai"]
const DEFAULT_SIZES: Sizes = {
  monitor: { width: 280, height: 240 },
  files: { width: 600, height: 280 },
  ai: { width: 420, height: 320 },
}
const WIDTH_KEYS = {
  monitor: "terminal-monitor-panel-width",
  files: "file-manager-panel-width",
  ai: "easyssh:terminal-ai-assistant:panel-width",
}
const preferenceKey = (key: TerminalPanelKey, axis: Axis) => axis === "width"
  ? WIDTH_KEYS[key]
  : `terminal-${key}-panel-height`

function readSizes(preferences?: SshWorkspacePreferenceAdapter): Sizes {
  const sizes = structuredClone(DEFAULT_SIZES)
  for (const key of PANEL_KEYS) {
    for (const axis of ["width", "height"] as const) {
      const value = Number(preferences?.getString(preferenceKey(key, axis)))
      if (Number.isFinite(value) && value > 0) sizes[key][axis] = value
    }
  }
  return sizes
}

/** One owner for grid tracks and resize handles, so panel dimensions cannot conflict. */
export function useTerminalPanelLayout({ enabled, positions, visiblePanels, preferences }: {
  enabled: boolean
  positions: Record<TerminalPanelKey, TerminalPanelPosition>
  visiblePanels: TerminalPanelKey[]
  preferences?: SshWorkspacePreferenceAdapter
}) {
  const { t } = useTranslation("terminal")
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [sizes, setSizes] = useState(() => readSizes(preferences))
  const [resizing, setResizing] = useState<TerminalPanelKey | null>(null)
  const drag = useRef<{
    key: TerminalPanelKey; axis: Axis; coordinate: number; size: number
    min: number; max: number; direction: number; next: Sizes; peers: TerminalPanelKey[]
  } | null>(null)

  useEffect(() => { setSizes(readSizes(preferences)) }, [preferences])
  useLayoutEffect(() => {
    if (!enabled || !element) return
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, enabled])

  const layoutKey = visiblePanels.map(key => `${key}:${positions[key]}`).join(",")
  useEffect(() => {
    drag.current = null
    setResizing(null)
  }, [enabled, layoutKey, bounds.width, bounds.height])
  const resizePosition = resizing ? positions[resizing] : null
  useEffect(() => {
    if (!resizePosition) return
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = resizePosition === "bottom" ? "row-resize" : "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = cursor
      document.body.style.userSelect = userSelect
    }
  }, [resizePosition])

  const left = visiblePanels.filter(key => positions[key] === "left")
  const right = visiblePanels.filter(key => positions[key] === "right")
  const bottom = visiblePanels.filter(key => positions[key] === "bottom")
  const sides = [...left, ...right]
  const budget = { width: bounds.width * 0.7, height: bounds.height * 0.6 }
  const fitted = structuredClone(sizes)
  for (const [axis, keys] of [["width", sides], ["height", bottom]] as const) {
    const total = keys.reduce((sum, key) => sum + sizes[key][axis], 0)
    const scale = total > 0 ? Math.min(1, budget[axis] / total) : 1
    keys.forEach(key => { fitted[key][axis] = sizes[key][axis] * scale })
  }
  const terminalColumn = left.length + 1
  const gridStyle: CSSProperties = enabled ? {
    gridTemplateColumns: [...left.map(key => `${fitted[key].width}px`), "minmax(0, 1fr)", ...right.map(key => `${fitted[key].width}px`)].join(" "),
    gridTemplateRows: ["minmax(0, 1fr)", ...bottom.map(key => `${fitted[key].height}px`)].join(" "),
  } : { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }
  const placement = (key: TerminalPanelKey): CSSProperties | undefined => {
    if (!enabled) return undefined
    if (!visiblePanels.includes(key)) return { display: "none" }
    const bottomIndex = bottom.indexOf(key)
    if (bottomIndex >= 0) return { gridColumn: "1 / -1", gridRow: bottomIndex + 2 }
    const leftIndex = left.indexOf(key)
    return { gridColumn: leftIndex >= 0 ? leftIndex + 1 : terminalColumn + 1 + right.indexOf(key), gridRow: 1 }
  }
  const limits = (key: TerminalPanelKey) => {
    const axis: Axis = positions[key] === "bottom" ? "height" : "width"
    const peers = axis === "width" ? sides : bottom
    const otherSize = peers.reduce((sum, peer) => sum + (peer === key ? 0 : fitted[peer][axis]), 0)
    const max = Math.max(0, budget[axis] - otherSize)
    const min = Math.min(axis === "width" ? 180 : 100, budget[axis] / peers.length / 2, fitted[key][axis], max)
    return { axis, peers, min, max }
  }
  const save = (next: Sizes, peers: TerminalPanelKey[], axis: Axis) => {
    peers.forEach(key => { void preferences?.setString(preferenceKey(key, axis), String(next[key][axis])) })
  }
  const endResize = () => {
    const current = drag.current
    if (!current) return
    drag.current = null
    setResizing(null)
    save(current.next, current.peers, current.axis)
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const coordinate = current.axis === "width" ? event.clientX : event.clientY
    const size = Math.max(current.min, Math.min(current.max, current.size + (coordinate - current.coordinate) * current.direction))
    current.next = { ...current.next, [current.key]: { ...current.next[current.key], [current.axis]: size } }
    setSizes(current.next)
  }
  const labels = { monitor: t("ariaMonitor"), files: t("ariaFileManager"), ai: t("ariaAiAssistant") }
  const handles = enabled && visiblePanels.map(key => {
    const position = positions[key]
    const { axis, peers, min, max } = limits(key)
    const label = t("resizeDockedPanel", { panel: labels[key] })
    return <div key={key} className="pointer-events-none relative z-[55] min-h-0 min-w-0" style={placement(key)}>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        title={label}
        aria-orientation={axis === "width" ? "vertical" : "horizontal"}
        aria-valuemin={Math.floor(min)}
        aria-valuemax={Math.ceil(max)}
        aria-valuenow={Math.round(fitted[key][axis])}
        className={cn(
          "pointer-events-auto absolute touch-none select-none rounded-sm transition-colors hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none",
          position === "bottom" ? "inset-x-0 top-0 h-1.5 cursor-row-resize" : "inset-y-0 w-1.5 cursor-col-resize",
          position === "left" && "right-0",
          position === "right" && "left-0",
          resizing === key && "bg-primary/40",
        )}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current) return
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          const next = structuredClone(sizes)
          peers.forEach(peer => { next[peer][axis] = fitted[peer][axis] })
          drag.current = {
            key, axis, peers, min, max, next, size: fitted[key][axis],
            coordinate: axis === "width" ? event.clientX : event.clientY,
            direction: position === "left" ? 1 : -1,
          }
          setSizes(next)
          setResizing(key)
        }}
        onPointerMove={moveResize}
        onPointerUp={event => {
          moveResize(event)
          endResize()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
        onKeyDown={event => {
          const direction = axis === "width"
            ? event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
            : event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
          if (!direction) return
          event.preventDefault()
          event.stopPropagation()
          const next = structuredClone(sizes)
          peers.forEach(peer => { next[peer][axis] = fitted[peer][axis] })
          next[key][axis] = Math.max(min, Math.min(max, fitted[key][axis] + direction * (position === "left" ? 1 : -1) * (event.shiftKey ? 40 : 10)))
          setSizes(next)
          save(next, peers, axis)
        }}
      />
    </div>
  })
  return { layoutRef: setElement, gridStyle, placement, terminalColumn, handles }
}
