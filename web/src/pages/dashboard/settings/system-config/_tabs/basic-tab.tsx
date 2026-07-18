
import { useTranslation } from "react-i18next"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSelect } from "@/components/settings/form-field"
import { Settings } from "lucide-react"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { basicInfoSchema } from "@/schemas/settings/system-config.schema"
import { settingsApi } from "@/lib/api/settings"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { useSystemConfig } from "@/contexts/system-config-context"

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

  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    schema: basicInfoSchema,
    loadFn: async () => {
      const data = await settingsApi.getSystemConfig()
      return {
        system_name: data.system_name,
        system_logo: data.system_logo,
        system_favicon: data.system_favicon,
        default_language: data.default_language,
        default_timezone: data.default_timezone,
        date_format: data.date_format,
      }
    },
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
    <div className="flex flex-1 min-h-0 flex-col">
      {/* 可滚动内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4">
        <div className="space-y-4">
          <SettingsSection
            title={t("sectionTitle")}
            description={t("sectionDescription")}
            icon={<Settings className="h-5 w-5" />}
            actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
          >
            <FormInput
              form={form}
              name="system_name"
              label={t("fieldSystemName")}
              description={t("fieldSystemNameDesc")}
              required
              placeholder="EasySSH"
            />

            <FormInput
              form={form}
              name="system_logo"
              label={t("fieldSystemLogo")}
              description={t("fieldSystemLogoDesc")}
              type="url"
              placeholder="https://example.com/logo.svg"
            />

            {logoUrl && (
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium mb-2">{t("logoPreviewTitle")}</p>
                {/* 这里需要预览任意用户输入的外部图片 URL。 */}
                <img
                  src={logoUrl}
                  alt={t("logoPreviewTitle")}
                  className="h-16 w-auto object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              </div>
            )}

            <FormInput
              form={form}
              name="system_favicon"
              label={t("fieldFavicon")}
              description={t("fieldFaviconDesc")}
              type="url"
              placeholder="https://example.com/favicon.ico"
            />

            {faviconUrl && (
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium mb-2">{t("faviconPreviewTitle")}</p>
                {/* 这里需要预览任意用户输入的外部图片 URL。 */}
                <img
                  src={faviconUrl}
                  alt={t("faviconPreviewTitle")}
                  className="h-8 w-auto object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              </div>
            )}

            <FormSelect
              form={form}
              name="default_language"
              label={t("fieldDefaultLanguage")}
              description={t("fieldDefaultLanguageDesc")}
              required
              options={languageOptions}
              placeholder={t("fieldDefaultLanguage")}
            />

            <FormSelect
              form={form}
              name="default_timezone"
              label={t("fieldDefaultTimezone")}
              description={t("fieldDefaultTimezoneDesc")}
              required
              options={timezoneOptions}
              placeholder={t("fieldDefaultTimezone")}
            />

            <FormSelect
              form={form}
              name="date_format"
              label={t("fieldDateFormat")}
              description={t("fieldDateFormatDesc")}
              required
              options={dateFormatOptions}
              placeholder={t("fieldDateFormat")}
            />

            {selectedFormat && (
              <div className="rounded-lg border p-4 bg-muted/50">
                <p className="text-sm font-medium mb-1">{t("dateFormatPreviewTitle")}</p>
                <p className="text-lg font-mono">{formatPreview(selectedFormat)}</p>
              </div>
            )}
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
