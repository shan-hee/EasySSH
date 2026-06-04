import { cn } from "@/lib/utils"
import type { SessionTabDropSide } from "@/components/tabs/session-tab-bar"

interface SessionSplitDropOverlayProps {
  side: SessionTabDropSide | null
}

export function SessionSplitDropOverlay({ side }: SessionSplitDropOverlayProps) {
  if (!side) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-50 grid grid-cols-2 gap-2 p-3">
      {(["left", "right"] as const).map((item) => (
        <div
          key={item}
          className={cn(
            "min-h-0 border border-dashed transition-colors",
            item === side
              ? "border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]"
              : "border-border/35 bg-background/20 opacity-60"
          )}
        />
      ))}
    </div>
  )
}
