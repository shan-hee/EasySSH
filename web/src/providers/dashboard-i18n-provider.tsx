
import type { ReactNode } from "react"
import { useEffect } from "react"
import { I18nextProvider } from "react-i18next"
import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"
import { getEffectiveLocale, saveLocaleToStorage } from "@/utils/datetime"
import { i18n } from "@/i18n"

interface DashboardI18nProviderProps {
  children: ReactNode
}

export function DashboardI18nProvider({ children }: DashboardI18nProviderProps) {
  const { user } = useClientAuth()
  const { config } = useSystemConfig()

  // 直接调用 getEffectiveLocale，它会自动从 localStorage 读取
  const locale = getEffectiveLocale(user, config)

  useEffect(() => {
    void i18n.changeLanguage(locale)
  }, [locale])

  // 当用户数据加载完成后，同步语言设置到 localStorage
  useEffect(() => {
    if (user?.language && (user.language === "zh-CN" || user.language === "en-US")) {
      saveLocaleToStorage(user.language)
    }
  }, [user?.language])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
