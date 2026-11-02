import type { ReactNode } from "react"
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/** 传输列表的统一外观；SFTP 会话传输与远程工作区的本机传输共用。 */

export type TransferRowTone = "running" | "pending" | "completed" | "failed" | "cancelled" | "unknown"

const typeIcons = {
  upload: ArrowUp,
  download: ArrowDown,
  transfer: ArrowLeftRight,
} as const

const toneClassNames: Record<TransferRowTone, string> = {
  running: "text-primary",
  pending: "text-muted-foreground",
  completed: "text-status-connected",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  unknown: "text-status-warning",
}

interface TransferListPopoverProps {
  title: string
  activeCount: number
  /** 页头中显示文字标签；工具栏中只显示图标。 */
  showLabel?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  headerAction?: ReactNode
  notice?: ReactNode
  empty: string
  footer?: ReactNode
  items: ReactNode[]
}

export function TransferListPopover({
  title,
  activeCount,
  showLabel = false,
  open,
  onOpenChange,
  headerAction,
  notice,
  empty,
  footer,
  items,
}: TransferListPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={showLabel ? "sm" : "icon"}
          className={cn("relative text-muted-foreground hover:bg-accent hover:text-accent-foreground", !showLabel && "h-7 w-7 rounded-md")}
          title={title}
          aria-label={title}
        >
          <ArrowUpDown className="size-3.5" />
          {showLabel && title}
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground tabular-nums">
              {activeCount > 99 ? "99+" : activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[min(400px,calc(100vw-24px))] p-0 [--wails-draggable:no-drag]">
        <div className="flex h-10 items-center justify-between gap-2 border-b pl-3 pr-1.5">
          <span className="text-sm font-semibold">{title}</span>
          {headerAction}
        </div>
        {notice}
        {items.length > 0 ? (
          <div className="max-h-[min(420px,60vh)] divide-y overflow-y-auto scrollbar-custom">{items}</div>
        ) : (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">{empty}</div>
        )}
        {footer}
      </PopoverContent>
    </Popover>
  )
}

interface TransferListRowProps {
  type: keyof typeof typeIcons
  typeLabel: string
  name: string
  /** 远端位置，用于定位文件。 */
  location?: string
  tone: TransferRowTone
  /** 仅在进行中且进度可知时显示进度条。 */
  progress?: number
  status: string
  meta?: string
  error?: string
  actions?: ReactNode
}

export function TransferListRow({ type, typeLabel, name, location, tone, progress, status, meta, error, actions }: TransferListRowProps) {
  const Icon = typeIcons[type]
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Icon className={cn("size-4 shrink-0", toneClassNames[tone])} aria-label={typeLabel} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
        {actions && <div className="-my-1 flex shrink-0 items-center">{actions}</div>}
      </div>
      {location && <p className="mt-0.5 truncate pl-6.5 text-xs text-muted-foreground" title={location}>{location}</p>}
      {progress !== undefined && <Progress value={progress} className="mt-2 ml-6.5 h-1 w-auto" />}
      <div className="mt-1 flex items-center justify-between gap-3 pl-6.5 text-xs">
        <span className={cn("min-w-0 truncate", tone === "running" ? "tabular-nums text-muted-foreground" : toneClassNames[tone])}>{status}</span>
        {meta && <span className="shrink-0 tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      {error && <p className="mt-1 line-clamp-2 break-all pl-6.5 text-xs text-destructive" title={error}>{error}</p>}
    </div>
  )
}

export function TransferRowAction({
  label,
  onClick,
  disabled,
  destructive = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("size-6", destructive && "text-muted-foreground hover:text-destructive")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  )
}
