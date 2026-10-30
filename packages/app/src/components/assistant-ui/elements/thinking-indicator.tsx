"use client"

import { useEffect, useState, type ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { mono } from "./surfaces"

export function ThinkingIndicator({
  label,
  elapsed,
  active = true,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "label" | "elapsed"> & {
  label: string
  elapsed?: string
  active?: boolean
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    )
    return () => window.clearInterval(timer)
  }, [active])
  const elapsedLabel = elapsed ?? (active && seconds > 0 ? `${seconds}s` : undefined)
  return (
    <div
      role="status"
      data-slot="thinking-indicator"
      className={cn("flex items-center gap-2 font-mono text-xs text-muted-foreground", className)}
      {...props}
    >
      <span aria-hidden className="shrink-0 text-primary">
        {">"}
      </span>
      <span
        className={cn("inline-block leading-5", active && "shimmer motion-reduce:animate-none")}
      >
        {label}
      </span>
      {elapsedLabel !== undefined && (
        <span className={cn(mono, "text-muted-foreground tabular-nums")}>{elapsedLabel}</span>
      )}
    </div>
  )
}
