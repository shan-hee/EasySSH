import { Button } from "@/components/ui/button"
import { ThemeMenu } from "@/components/theme-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Check,
  Languages,
} from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslation } from "react-i18next"
import { DesktopNotificationCenter } from "./desktop-notification-center"

const localeOptions: Array<{ value: Locale; labelKey: "languageZhCN" | "languageEnUS" }> = [
  { value: "zh-CN", labelKey: "languageZhCN" },
  { value: "en-US", labelKey: "languageEnUS" },
]

export function DesktopHeaderActions({
  locale,
  onLocaleChange,
  onOpenTask,
}: {
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  onOpenTask: (taskID?: string) => void
}) {
  const { t } = useTranslation("headerActions")

  return (
    <div className="flex shrink-0 items-center gap-1">
      <DesktopNotificationCenter onOpenTask={onOpenTask} />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("languageTooltip")}>
                <Languages />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("languageTooltip")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{t("languageTitle")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {localeOptions.map((option) => (
            <DropdownMenuItem key={option.value} onSelect={() => onLocaleChange(option.value)}>
              <span className="flex-1">{t(option.labelKey)}</span>
              {locale === option.value ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeMenu />
    </div>
  )
}
