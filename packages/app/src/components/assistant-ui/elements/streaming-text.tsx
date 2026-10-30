import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

// Official StreamingText presentation; Streamdown supplies real incremental Markdown spans.
export const streamingTextAnimation = {
  animation: "aui-stream-word",
  duration: 500,
  sep: "word" as const
}

export function StreamingText({
  streaming,
  className,
  ...props
}: ComponentProps<"div"> & { streaming: boolean }) {
  return (
    <div
      data-slot="streaming-text"
      data-streaming={streaming}
      className={cn("aui-streaming-text min-w-0 text-sm leading-relaxed", className)}
      {...props}
    />
  )
}
