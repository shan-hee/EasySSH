import { useTranslation } from "react-i18next"
import { ShieldCheck, TimerReset } from "lucide-react"
import { settingsApi } from "@/lib/api/settings"
import { loginSecuritySchema, loginSessionSchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
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
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
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
      icon={<TimerReset className="h-5 w-5" />}
      actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
    >
      {isLoading ? <SectionLoading /> : <>
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="session_timeout" label={t("sessionTimeout")} description={t("sessionTimeoutDescription")} type="number" min={5} max={1440} />
          <FormSwitch form={form} name="remember_login" label={t("rememberLogin")} description={t("rememberLoginDescription")} />
        </div>
      </>}
    </SettingsSection>
  )
}

function LoginSecuritySection() {
  const { t } = useTranslation("settingsAuthentication")
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    cacheKey: "login-security",
    schema: loginSecuritySchema,
    loadFn: settingsApi.getLoginSecurityConfig,
    saveFn: settingsApi.saveLoginSecurityConfig,
  })

  return (
    <SettingsSection
      title={t("loginProtectionTitle")}
      description={t("loginProtectionDescription")}
      icon={<ShieldCheck className="h-5 w-5" />}
      actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
    >
      {isLoading ? <SectionLoading /> : <>
        <div className="grid gap-4 lg:grid-cols-2">
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
    <div className="p-4">
      <div className="space-y-8">
        <LoginSessionSection />
        <LoginSecuritySection />
      </div>
    </div>
  )
}
