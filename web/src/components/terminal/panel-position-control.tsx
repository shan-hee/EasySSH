import { PanelLeft, PanelRight, PanelBottom } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { TerminalPanelPosition } from "@/stores/tab-ui-store"
import { cn } from "@/lib/utils"

export function PanelPositionControl({ position, onChange }: {
  position: TerminalPanelPosition
  onChange: (position: TerminalPanelPosition) => void
}) {
  const { t } = useTranslation("terminal")
  return (
    <div role="group" aria-label={t("panelPosition")} className="flex shrink-0 items-center gap-0.5">
      {([["left", PanelLeft], ["right", PanelRight], ["bottom", PanelBottom]] as const).map(([value, Icon]) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          className={cn("size-6", position === value && "bg-accent text-accent-foreground")}
          aria-pressed={position === value}
          aria-label={t(`panelPosition_${value}`)}
          title={t(`panelPosition_${value}`)}
          onClick={() => onChange(value)}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </div>
  )
}
