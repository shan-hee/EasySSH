
import type { ReactNode } from "react"
import { useEffect } from "react"
import { I18nextProvider } from "react-i18next"
import { useSystemConfig } from "@/contexts/system-config-context"
import { getEffectiveLocale } from "@/utils/datetime"
import { i18n } from "@/i18n"

interface AuthI18nProviderProps {
  children: ReactNode
}

/**
 * 认证/初始化流程使用的 i18n Provider
 * 优先使用 localStorage 缓存的语言设置（避免闪烁）
 * 其次依赖系统配置中的默认语言
 * 不依赖登录用户信息（因为用户可能未登录）
 */
export function AuthI18nProvider({ children }: AuthI18nProviderProps) {
  const { config } = useSystemConfig()

  const locale = getEffectiveLocale(null, config)

  useEffect(() => {
    void i18n.changeLanguage(locale)
  }, [locale])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
