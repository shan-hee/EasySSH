
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  Check,
  Languages,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ThemeMenu } from "@/components/theme-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useOptionalClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { authApi } from "@/lib/api/auth"
import { getEffectiveLocale, saveLocaleToStorage } from "@/utils/datetime"
import { NotificationCenter } from "@/components/notification-center"

type SupportedLocale = "zh-CN" | "en-US"

const localeOptions: Array<{ value: SupportedLocale; labelKey: "languageZhCN" | "languageEnUS" }> = [
  { value: "zh-CN", labelKey: "languageZhCN" },
  { value: "en-US", labelKey: "languageEnUS" },
]

export function DashboardHeaderActions() {
  const { t } = useTranslation("headerActions")
  const clientAuth = useOptionalClientAuth()
  const user = clientAuth?.user ?? null
  const isAuthenticated = clientAuth?.isAuthenticated ?? false
  const refreshUser = clientAuth?.refreshUser
  const { config } = useSystemConfig()
  const [languageSaving, setLanguageSaving] = React.useState<SupportedLocale | null>(null)
  useUpdateCheck(t)

  const locale = React.useMemo(() => getEffectiveLocale(user, config), [user, config])

  const handleLanguageChange = React.useCallback(
    async (nextLocale: SupportedLocale) => {
      if (nextLocale === locale || languageSaving) {
        return
      }

      const previousLocale = locale
      setLanguageSaving(nextLocale)
      saveLocaleToStorage(nextLocale)

      try {
        if (isAuthenticated) {
          await authApi.updateProfile({ language: nextLocale })
          await refreshUser?.()
        }
        toast.success(t("languageSaved"))
      } catch (error: unknown) {
        saveLocaleToStorage(previousLocale)
        toast.error(getErrorMessage(error, t("languageSaveFailed")))
      } finally {
        setLanguageSaving(null)
      }
    },
    [isAuthenticated, languageSaving, locale, refreshUser, t],
  )

  return (
    <div className="flex shrink-0 items-center gap-1">
      <NotificationCenter />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("languageTooltip")}>
                <Languages />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("languageTooltip")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{t("languageTitle")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {localeOptions.map((option) => {
            const isSelected = option.value === locale
            const isSaving = languageSaving === option.value

            return (
              <DropdownMenuItem
                key={option.value}
                disabled={!!languageSaving}
                onSelect={() => {
                  void handleLanguageChange(option.value)
                }}
              >
                <span className="flex-1">{t(option.labelKey)}</span>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isSelected ? (
                  <Check className="size-4" />
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeMenu />
    </div>
  )
}

function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error && typeof error === "object") {
    if ("detail" in error) {
      const detail = error.detail
      if (typeof detail === "string") {
        return detail
      }
      if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
        return detail.message
      }
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message
    }
  }

  return defaultMessage
}
