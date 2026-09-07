"use client"

// Official Elements ErrorState with an action slot for recoveries supported by the host.
import type { ComponentProps, ReactNode } from "react"
import { CircleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function ErrorState({
  title,
  detail,
  action,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title" | "children" | "role"> & {
  title?: string
  detail: string
  action?: ReactNode
}) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex w-full items-start gap-2.5 rounded-2xl bg-destructive/10 px-4 py-3 text-sm",
        className
      )}
      {...props}
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-medium text-destructive">{title}</p>}
        <p className={cn("text-[13px] leading-snug text-destructive", title && "mt-0.5")}>
          {detail}
        </p>
      </div>
      {action}
    </div>
  )
}
