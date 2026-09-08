import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

// Official MessagePair layout. Runtime message slots preserve Markdown, tools and actions.
export function MessagePair({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-pair"
      className={cn("flex w-full min-w-0 flex-col gap-5", className)}
      {...props}
    />
  )
}
