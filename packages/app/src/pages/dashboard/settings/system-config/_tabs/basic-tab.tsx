
import { useTranslation } from "react-i18next"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"
import { FormInput, FormSelect } from "@/components/settings/form-field"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { basicInfoSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useSystemConfig } from "@/contexts/system-config-context"
import { loadSystemBasicSettings } from "@/lib/dashboard-query-options"

export function BasicTab() {
  const { t } = useTranslation("settingsSystemBasic")
  const { refreshConfig } = useSystemConfig()
  const languageOptions = [
    { label: t("languageZhCN"), value: "zh-CN" },
    { label: t("languageEnUS"), value: "en-US" },
  ]

  const timezoneOptions = [
    { label: t("timezoneAsiaShanghai"), value: "Asia/Shanghai" },
    { label: t("timezoneAsiaTokyo"), value: "Asia/Tokyo" },
    { label: t("timezoneAsiaHongKong"), value: "Asia/Hong_Kong" },
    { label: t("timezoneAmericaNewYork"), value: "America/New_York" },
    { label: t("timezoneAmericaLosAngeles"), value: "America/Los_Angeles" },
    { label: t("timezoneEuropeLondon"), value: "Europe/London" },
    { label: t("timezoneEuropeParis"), value: "Europe/Paris" },
    { label: t("timezoneUTC"), value: "UTC" },
  ]

  const dateFormatOptions = [
    { label: "YYYY-MM-DD HH:mm:ss", value: "YYYY-MM-DD HH:mm:ss" },
    { label: "YYYY/MM/DD HH:mm:ss", value: "YYYY/MM/DD HH:mm:ss" },
    { label: "DD/MM/YYYY HH:mm:ss", value: "DD/MM/YYYY HH:mm:ss" },
    { label: "MM/DD/YYYY HH:mm:ss", value: "MM/DD/YYYY HH:mm:ss" },
    { label: "YYYY-MM-DD", value: "YYYY-MM-DD" },
    { label: "DD-MM-YYYY", value: "DD-MM-YYYY" },
  ]

  const { form, isLoading } = useSettingsForm({
    cacheKey: "system-basic",
    schema: basicInfoSchema,
    loadFn: loadSystemBasicSettings,
    saveFn: async (data) => {
      await settingsApi.saveBasicInfo(data)
      await refreshConfig()
    },
  })

  if (isLoading) {
    return <SettingsLoading />
  }

  const logoUrl = form.watch("system_logo")
  const faviconUrl = form.watch("system_favicon")
  const selectedFormat = form.watch("date_format")
  const currentDate = new Date()

  // 简单的日期格式化示例
  const formatPreview = (format: string) => {
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, "0")
    const day = String(currentDate.getDate()).padStart(2, "0")
    const hours = String(currentDate.getHours()).padStart(2, "0")
    const minutes = String(currentDate.getMinutes()).padStart(2, "0")
    const seconds = String(currentDate.getSeconds()).padStart(2, "0")

    return format
      .replace("YYYY", String(year))
      .replace("MM", month)
      .replace("DD", day)
      .replace("HH", hours)
      .replace("mm", minutes)
      .replace("ss", seconds)
  }

  return (
    <div className="space-y-6 p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormInput form={form} name="system_name" label={t("fieldSystemName")} description={t("fieldSystemNameDesc")} required placeholder="EasySSH" className="lg:col-span-2" />
        <ImageUrlField form={form} name="system_logo" label={t("fieldSystemLogo")} placeholder="https://example.com/logo.svg" url={logoUrl} previewClassName="h-10" />
        <ImageUrlField form={form} name="system_favicon" label={t("fieldFavicon")} placeholder="https://example.com/favicon.ico" url={faviconUrl} previewClassName="h-6" />
      </div>
      <div className="grid gap-4 border-t pt-6 lg:grid-cols-3">
        <FormSelect form={form} name="default_language" label={t("fieldDefaultLanguage")} description={t("fieldDefaultLanguageDesc")} required options={languageOptions} />
        <FormSelect form={form} name="default_timezone" label={t("fieldDefaultTimezone")} description={t("fieldDefaultTimezoneDesc")} required options={timezoneOptions} />
        <FormSelect form={form} name="date_format" label={t("fieldDateFormat")} description={selectedFormat ? t("dateFormatPreview", { value: formatPreview(selectedFormat) }) : undefined} required options={dateFormatOptions} />
      </div>
    </div>
  )
}

// Previews any user-provided image URL next to its field; broken images hide themselves.
function ImageUrlField<T extends FieldValues>({ form, name, label, placeholder, url, previewClassName }: {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  placeholder: string
  url?: string
  previewClassName: string
}) {
  return (
    <div className="flex items-end gap-3">
      <FormInput form={form} name={name} label={label} type="url" placeholder={placeholder} className="min-w-0 flex-1" />
      {url && <img key={url} src={url} alt="" className={`mb-1.5 w-auto shrink-0 object-contain ${previewClassName}`} onError={(event) => { event.currentTarget.style.display = "none" }} />}
    </div>
  )
}
