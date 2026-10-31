import { useTranslation } from "react-i18next"
import { settingsApi } from "@/lib/api/settings"
import { loginSecuritySchema, loginSessionSchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSwitch } from "@/components/settings/form-field"
import { useSystemConfig } from "@/contexts/system-config-context"
import { PageLoading } from "@/components/page-loading"

function SectionLoading() {
  return <PageLoading className="min-h-24 bg-transparent" />
}

function LoginSessionSection() {
  const { t } = useTranslation("settingsAuthentication")
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading } = useSettingsForm({
    cacheKey: "login-session",
    schema: loginSessionSchema,
    loadFn: settingsApi.getLoginSessionConfig,
    saveFn: async (data) => {
      await settingsApi.saveLoginSessionConfig(data)
      await refreshConfig()
    },
  })

  return (
    <SettingsSection
      title={t("loginSessionTitle")}
      description={t("loginSessionDescription")}
    >
      {isLoading ? <SectionLoading /> : <>
        <FormInput form={form} name="session_timeout" label={t("sessionTimeout")} description={t("sessionTimeoutDescription")} type="number" min={5} max={1440} className="max-w-sm" />
        <FormSwitch form={form} name="remember_login" label={t("rememberLogin")} description={t("rememberLoginDescription")} />
      </>}
    </SettingsSection>
  )
}

function LoginSecuritySection() {
  const { t } = useTranslation("settingsAuthentication")
  const { form, isLoading } = useSettingsForm({
    cacheKey: "login-security",
    schema: loginSecuritySchema,
    loadFn: settingsApi.getLoginSecurityConfig,
    saveFn: settingsApi.saveLoginSecurityConfig,
  })

  return (
    <SettingsSection
      title={t("loginProtectionTitle")}
      description={t("loginProtectionDescription")}
    >
      {isLoading ? <SectionLoading /> : <>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormInput form={form} name="login_limit" label={t("loginLimit")} type="number" min={1} max={100} />
          <FormInput form={form} name="two_fa_limit" label={t("twoFALimit")} type="number" min={1} max={20} />
          <FormInput form={form} name="api_limit" label={t("apiLimit")} type="number" min={10} max={10000} />
        </div>
      </>}
    </SettingsSection>
  )
}

export function AuthenticationTab() {
  return (
    <div className="space-y-6 p-4">
      <LoginSessionSection />
      <div className="border-t" />
      <LoginSecuritySection />
    </div>
  )
}
