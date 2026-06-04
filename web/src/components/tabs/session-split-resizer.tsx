import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react"
import { GripHorizontal, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SessionSplitOrientation } from "@/lib/session/split-layout"

interface SessionSplitResizerProps {
  orientation: SessionSplitOrientation
  sizes: number[]
  index: number
  containerRef: RefObject<HTMLElement | null>
  onResize: (sizes: number[]) => void
}

const MIN_PANE_RATIO = 0.16

export function SessionSplitResizer({
  orientation,
  sizes,
  index,
  containerRef,
  onResize,
}: SessionSplitResizerProps) {
  const [isResizing, setIsResizing] = useState(false)
  const startPointRef = useRef(0)
  const startSizesRef = useRef<number[]>(sizes)
  const frameRef = useRef<number | null>(null)
  const pendingSizesRef = useRef<number[] | null>(null)

  useEffect(() => {
    if (!isResizing) {
      startSizesRef.current = sizes
    }
  }, [isResizing, sizes])

  const flushPendingResize = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    const pendingSizes = pendingSizesRef.current
    pendingSizesRef.current = null
    if (pendingSizes) {
      onResize(pendingSizes)
    }
  }, [onResize])

  const applyResize = useCallback((clientPoint: number) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const totalPx = orientation === "horizontal" ? rect.width : rect.height
    if (totalPx <= 0) return

    const currentSizes = startSizesRef.current
    const previousSize = currentSizes[index] ?? 0
    const nextSize = currentSizes[index + 1] ?? 0
    const pairTotal = previousSize + nextSize
    if (pairTotal <= 0) return

    const deltaRatio = (clientPoint - startPointRef.current) / totalPx
    const minPaneSize = Math.min(MIN_PANE_RATIO, pairTotal / 2)
    const nextPreviousSize = Math.min(
      pairTotal - minPaneSize,
      Math.max(minPaneSize, previousSize + deltaRatio)
    )
    const nextSizes = [...currentSizes]
    nextSizes[index] = nextPreviousSize
    nextSizes[index + 1] = pairTotal - nextPreviousSize
    pendingSizesRef.current = nextSizes

    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const pendingSizes = pendingSizesRef.current
      pendingSizesRef.current = null
      if (pendingSizes) {
        onResize(pendingSizes)
      }
    })
  }, [containerRef, index, onResize, orientation])

  const handleResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    startPointRef.current = orientation === "horizontal" ? event.clientX : event.clientY
    startSizesRef.current = sizes
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [orientation, sizes])

  const handleResizeMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    applyResize(orientation === "horizontal" ? event.clientX : event.clientY)
  }, [applyResize, isResizing, orientation])

  const handleResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    flushPendingResize()
    setIsResizing(false)
  }, [flushPendingResize, isResizing])

  useEffect(() => {
    if (!isResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [isResizing, orientation])

  const isHorizontal = orientation === "horizontal"
  const GripIcon = isHorizontal ? GripVertical : GripHorizontal

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      className={cn(
        "group relative shrink-0 touch-none transition-colors",
        isHorizontal
          ? "w-1 cursor-col-resize"
          : "h-1 cursor-row-resize",
        isResizing && "bg-primary/25"
      )}
      onPointerDown={handleResizeStart}
      onPointerMove={handleResizeMove}
      onPointerUp={handleResizeEnd}
      onPointerCancel={handleResizeEnd}
    >
      <div
        className={cn(
          "absolute flex items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100",
          isHorizontal
            ? "left-1/2 top-1/2 h-8 w-5 -translate-x-1/2 -translate-y-1/2"
            : "left-1/2 top-1/2 h-5 w-8 -translate-x-1/2 -translate-y-1/2",
          isResizing && "opacity-100"
        )}
      >
        <GripIcon className="h-3.5 w-3.5" />
      </div>
    </div>
  )
}
