// Components from the official elements-composer registry; runtime wiring lives in composer.aui.tsx.
import type { ComponentProps } from "react"
import { ArrowUpIcon, PlusIcon, SquareIcon, MicIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { paper, ghostButton, inkButton, iconSwap, iconSwapIn, iconSwapOut } from "./surfaces"

export function ComposerBar({
  dragActive = false,
  className,
  ...props
}: ComponentProps<"div"> & { dragActive?: boolean }) {
  return (
    <div
      data-slot="composer-bar"
      data-drag-active={dragActive || undefined}
      className={cn(
        paper,
        "flex w-full flex-col gap-2 rounded-[calc(var(--radius)+12px)] p-2.5 transition-colors",
        dragActive && "bg-primary/10",
        className
      )}
      {...props}
    />
  )
}

export function ComposerToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-toolbar"
      className={cn("flex items-center justify-between", className)}
      {...props}
    />
  )
}

export function ComposerActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="composer-actions" className={cn("flex items-center gap-1.5", className)} {...props} />
  )
}

export function ComposerAttachButton({ className, ...props }: Omit<ComponentProps<"button">, "children">) {
  const { t } = useTranslation("aiAssistant")
  return (
    <button
      type="button"
      aria-label={t("attachFile")}
      data-slot="composer-attach"
      disabled={!props.onClick}
      className={cn(ghostButton, "size-8 disabled:pointer-events-none disabled:opacity-30", className)}
      {...props}
    >
      <PlusIcon className="size-4" />
    </button>
  )
}

export function ComposerVoiceButton({
  active,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { active: boolean }) {
  const { t } = useTranslation("aiAssistant")
  return (
    <button
      type="button"
      aria-label={t(active ? "auiStopDictation" : "auiStartDictation")}
      data-slot="composer-voice-button"
      className={cn(
        active
          ? cn(inkButton, "flex size-8 items-center justify-center rounded-full")
          : cn(ghostButton, "size-8"),
        className
      )}
      {...props}
    >
      {active ? <SquareIcon className="size-3 fill-current" /> : <MicIcon className="size-4" />}
    </button>
  )
}

export function ComposerSend({
  streaming,
  idle,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  streaming: boolean
  idle: boolean
}) {
  const { t } = useTranslation("aiAssistant")
  return (
    <button
      type="button"
      aria-label={t(streaming ? "stopGenerating" : "send")}
      data-slot="composer-send"
      className={cn(
        "grid size-8 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40",
        streaming || !idle
          ? inkButton
          : "bg-foreground/[0.06] text-foreground/30 dark:bg-foreground/[0.09] transition-colors",
        className
      )}
      {...props}
    >
      <ArrowUpIcon className={cn(iconSwap, "size-4", streaming ? iconSwapOut : iconSwapIn)} />
      <SquareIcon className={cn(iconSwap, "size-3 fill-current", streaming ? iconSwapIn : iconSwapOut)} />
    </button>
  )
}
