import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import type { SessionTabDropSide } from "@/components/tabs/session-tab-bar"

interface SessionSplitDropOverlayProps {
  side: SessionTabDropSide | null
  edgeInset?: "none" | "workspace"
  topOffset?: number
}

export function SessionSplitDropOverlay({
  side,
  edgeInset = "none",
  topOffset = 0,
}: SessionSplitDropOverlayProps) {
  if (!side) return null

  const outerInsetPx = edgeInset === "workspace" ? 8 : 0
  const splitGapPx = 4
  const halfGapPx = splitGapPx / 2
  const horizontalCenterAfterGap = `calc(50% + ${halfGapPx}px)`
  const verticalTopPaneBottom = `calc(50% + ${halfGapPx - topOffset / 2}px)`
  const verticalBottomPaneTop = `calc(50% + ${halfGapPx + topOffset / 2}px)`

  const sectorStyle: Record<SessionTabDropSide, CSSProperties> = {
    top: {
      top: topOffset + outerInsetPx,
      right: outerInsetPx,
      bottom: verticalTopPaneBottom,
      left: outerInsetPx,
    },
    right: {
      top: topOffset + outerInsetPx,
      right: outerInsetPx,
      bottom: outerInsetPx,
      left: horizontalCenterAfterGap,
    },
    bottom: {
      top: verticalBottomPaneTop,
      right: outerInsetPx,
      bottom: outerInsetPx,
      left: outerInsetPx,
    },
    left: {
      top: topOffset + outerInsetPx,
      right: horizontalCenterAfterGap,
      bottom: outerInsetPx,
      left: outerInsetPx,
    },
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div
        className={cn(
          "absolute rounded-lg border border-dashed border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] transition-colors"
        )}
        style={sectorStyle[side]}
      />
    </div>
  )
}
