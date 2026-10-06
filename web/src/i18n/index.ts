import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { createNamespaceBackend } from "./namespace-backend"
import { reportResourceError } from "@/lib/resource-errors"

type Locale = "zh-CN" | "en-US"

const loaders = import.meta.glob<Record<string, unknown>>("./messages/*/*.json", { import: "default" })
const stored = typeof window === "undefined" ? null : window.localStorage.getItem("user-language")

void i18n
  .use(createNamespaceBackend(loaders, reportResourceError))
  .use(initReactI18next)
  .init({
    lng: stored === "en-US" ? "en-US" : "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    load: "currentOnly",
    fallbackLng: false,
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
      prefix: "{",
      suffix: "}",
    },
  })

export { i18n }
export type { Locale }
