import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { LayoutGrid, List, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type ServerViewMode = "grid" | "list"

/** Shared server-list controls; the caller owns data loading and permitted actions. */
export function ServerConnectionToolbar({
  search, onSearchChange, viewMode, onViewModeChange, total,
  groups = [], activeGroup = "all", onGroupChange, disabled = false, actions,
}: {
  search: string
  onSearchChange: (value: string) => void
  viewMode: ServerViewMode
  onViewModeChange: (value: ServerViewMode) => void
  total: number | string
  groups?: readonly (readonly [string, string, number])[]
  activeGroup?: string
  onGroupChange?: (id: string) => void
  disabled?: boolean
  actions?: ReactNode
}) {
  const { t } = useTranslation("servers")
  return (
    <div className="shrink-0 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            className="bg-card border-border pl-10 text-foreground placeholder:text-muted-foreground"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <div className="flex items-center rounded-md border bg-card p-0.5">
            {(["grid", "list"] as const).map((mode) => (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={viewMode === mode ? "secondary" : "ghost"}
                    size="icon-sm"
                    className="h-8 w-8"
                    onClick={() => onViewModeChange(mode)}
                    aria-label={t(mode === "grid" ? "viewGridTooltip" : "viewListTooltip")}
                    aria-pressed={viewMode === mode}
                  >
                    {mode === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t(mode === "grid" ? "viewGridTooltip" : "viewListTooltip")}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          {actions}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 py-1">
        {[["all", t("tabAll"), total] as const, ...groups].map(([id, label, count]) => (
          <Button
            key={id}
            type="button"
            variant={activeGroup === id ? "default" : "outline"}
            data-server-group-selected={activeGroup === id}
            aria-pressed={activeGroup === id}
            size="sm"
            className="h-8"
            onClick={() => onGroupChange?.(id)}
            disabled={disabled}
          >
            {label} ({count})
          </Button>
        ))}
      </div>
    </div>
  )
}
