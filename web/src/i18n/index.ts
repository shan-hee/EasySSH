import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import enUS from "@/i18n/messages/en-US"
import zhCN from "@/i18n/messages/zh-CN"

type Locale = "zh-CN" | "en-US"
type MessageCatalog = Record<string, unknown>

const catalogs: Record<Locale, MessageCatalog> = {
  "zh-CN": zhCN,
  "en-US": enUS,
}

function buildNamespaces(messages: MessageCatalog) {
  return {
    translation: messages,
    ...messages,
  }
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "zh-CN"
  }

  const stored = window.localStorage.getItem("user-language")
  return stored === "en-US" || stored === "zh-CN" ? stored : "zh-CN"
}

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": buildNamespaces(catalogs["zh-CN"]),
    "en-US": buildNamespaces(catalogs["en-US"]),
  },
  lng: getInitialLocale(),
  fallbackLng: "zh-CN",
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
})

export { i18n }
export type { Locale }
