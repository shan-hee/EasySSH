"use client"

// Composable surface and capability switches from official elements-settings-panel.
// Connection-specific fields are supplied by the host; unsupported model knobs are omitted.
import { useId, type ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { paper } from "./surfaces"

export function SettingsPanel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-panel"
      className={cn(paper, "flex w-full flex-col gap-4 rounded-[calc(var(--radius)+8px)] p-4", className)}
      {...props}
    />
  )
}

export function SettingsPanelToggle({
  label,
  detail,
  checked,
  onCheckedChange,
  disabled
}: {
  label: string
  detail?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const detailId = useId()
  return (
    <div className="flex items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px]">{label}</span>
        {detail && (
          <span id={detailId} className="text-xs text-foreground/35">
            {detail}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={detail ? detailId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          checked ? "bg-foreground/80" : "bg-foreground/15"
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-background transition-transform duration-200 motion-reduce:transition-none",
            checked && "translate-x-4"
          )}
        />
      </button>
    </div>
  )
}
