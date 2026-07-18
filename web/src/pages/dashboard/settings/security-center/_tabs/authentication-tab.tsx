import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Info,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
  UserPlus,
} from "lucide-react"
import { rolesApi, type Role } from "@/lib/api"
import { settingsApi } from "@/lib/api/settings"
import {
  googleAuthConfigSchema,
  oauthProviderConfigSchema,
  registrationConfigSchema,
} from "@/schemas/settings/system-config.schema"
import { loginSecuritySchema, loginSessionSchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSwitch, FormTextarea } from "@/components/settings/form-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSystemConfig } from "@/contexts/system-config-context"

function SectionLoading() {
  const { t } = useTranslation("common")
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      <span className="text-sm">{t("loading")}</span>
    </div>
  )
}

function RegistrationSection() {
  const { t } = useTranslation("settingsAuthentication")
  const { refreshConfig } = useSystemConfig()
  const [roles, setRoles] = useState<Role[]>([])

  useEffect(() => {
    void rolesApi.list().then((response) => setRoles(response.data || [])).catch(() => setRoles([]))
  }, [])

  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    schema: registrationConfigSchema,
    loadFn: async () => {
      const system = await settingsApi.getSystemConfig()
      return {
        allow_registration: system.allow_registration ?? false,
        default_role: system.default_role ?? "user",
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveRegistrationConfig(data)
      await refreshConfig()
    },
  })

  return (
    <SettingsSection
      title={t("registrationTitle")}
      description={t("registrationDescription")}
      icon={<UserPlus className="h-5 w-5" />}
      actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
    >
      {isLoading ? <SectionLoading /> : <>
        <FormSwitch form={form} name="allow_registration" label={t("allowRegistration")} description={t("allowRegistrationDescription")} />
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1">
            <Label>{t("defaultRole")}</Label>
            <p className="text-sm text-muted-foreground">{t("defaultRoleDescription")}</p>
          </div>
          <Select value={form.watch("default_role")} onValueChange={(value) => form.setValue("default_role", value, { shouldDirty: true })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roles.filter((role) => role.key !== "admin").map((role) => (
                <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </>}
    </SettingsSection>
  )
}

function GoogleAuthSection() {
  const { t } = useTranslation("settingsAuthentication")
  const { refreshConfig } = useSystemConfig()
  const [hasGoogleClientSecret, setHasGoogleClientSecret] = useState(false)

  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    schema: googleAuthConfigSchema,
    loadFn: async () => {
      const system = await settingsApi.getSystemConfig()
      setHasGoogleClientSecret(system.has_google_client_secret === true)
      return {
        oauth_enabled: system.oauth_enabled ?? false,
        google_client_id: system.google_client_id ?? "",
        google_client_secret: "",
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveGoogleAuthConfig(data)
      if (data.google_client_secret) setHasGoogleClientSecret(true)
      await refreshConfig()
    },
  })

  return (
    <SettingsSection
      title={t("googleTitle")}
      description={t("googleDescription")}
      icon={<LogIn className="h-5 w-5" />}
      actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
    >
      {isLoading ? <SectionLoading /> : <>
        <FormSwitch form={form} name="oauth_enabled" label={t("googleEnabled")} description={t("googleEnabledDescription")} />
        {form.watch("oauth_enabled") && <>
          <FormInput form={form} name="google_client_id" label={t("googleClientId")} placeholder="client-id.apps.googleusercontent.com" />
          <FormInput
            form={form}
            name="google_client_secret"
            label={t("googleClientSecret")}
            description={hasGoogleClientSecret ? t("secretConfigured") : t("googleClientSecretDescription")}
            type="password"
            placeholder="GOCSPX-..."
          />
          <Alert>
            <Info />
            <AlertDescription>
              {t("googleCallback", { url: typeof window === "undefined" ? "https://your-domain/auth/google/callback" : `${window.location.origin}/auth/google/callback` })}
            </AlertDescription>
          </Alert>
        </>}
      </>}
    </SettingsSection>
  )
}

function LoginSessionSection() {
  const { t } = useTranslation("settingsAuthentication")
  const { refreshConfig } = useSystemConfig()
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
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
          <FormSwitch form={form} name="password_pwned_check_enabled" label={t("pwnedCheck")} description={t("pwnedCheckDescription")} />
        </div>
      </>}
    </SettingsSection>
  )
}

function OAuthProviderSection() {
  const { t } = useTranslation("settingsAuthentication")
  const { refreshConfig } = useSystemConfig()
  const [externalProviderConfigured, setExternalProviderConfigured] = useState(false)
  const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
    schema: oauthProviderConfigSchema,
    loadFn: async () => {
      const system = await settingsApi.getSystemConfig()
      setExternalProviderConfigured(system.external_oauth_provider_configured === true)
      return {
        oauth_access_token_minutes: system.oauth_access_token_minutes ?? 15,
        oauth_refresh_token_days: system.oauth_refresh_token_days ?? 30,
        external_oauth_provider_enabled: system.external_oauth_provider_enabled ?? false,
        external_oauth_issuer: system.external_oauth_issuer ?? "",
        external_oauth_login_url: system.external_oauth_login_url ?? "",
        external_oauth_redirect_uris: system.external_oauth_redirect_uris ?? "",
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveOAuthProviderConfig(data)
      await refreshConfig()
    },
  })

  return (
    <SettingsSection
      title={t("providerTitle")}
      description={t("providerDescription")}
      icon={<KeyRound className="h-5 w-5" />}
      actions={<SettingsFormActions visible={isDirty} isSaving={isSaving} onReset={reset} onSave={handleSave} />}
    >
      {isLoading ? <SectionLoading /> : <>
        <FormSwitch
          form={form}
          name="external_oauth_provider_enabled"
          label={t("providerEnabled")}
          description={t("providerEnabledDescription")}
          disabled={!externalProviderConfigured}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="external_oauth_issuer" label={t("providerIssuer")} placeholder="https://ssh.example.com/api/v1" />
          <FormInput form={form} name="external_oauth_login_url" label={t("providerLoginUrl")} placeholder="https://ssh.example.com/login" />
        </div>
        <FormTextarea form={form} name="external_oauth_redirect_uris" label={t("providerRedirectUris")} description={t("providerRedirectUrisDescription")} rows={4} placeholder="https://client.example.com/auth/callback" />
        <div className="grid gap-4 lg:grid-cols-2">
          <FormInput form={form} name="oauth_access_token_minutes" label={t("accessTokenMinutes")} type="number" min={5} max={1440} />
          <FormInput form={form} name="oauth_refresh_token_days" label={t("refreshTokenDays")} type="number" min={1} max={365} />
        </div>
        {!externalProviderConfigured && <Alert>
          <Info />
          <AlertDescription>{t("providerRestartNotice")}</AlertDescription>
        </Alert>}
        <Alert>
          <TriangleAlert />
          <AlertDescription>{t("providerIssuerWarning")}</AlertDescription>
        </Alert>
      </>}
    </SettingsSection>
  )
}

export function AuthenticationTab() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-custom">
      <div className="space-y-8">
        <RegistrationSection />
        <GoogleAuthSection />
        <LoginSessionSection />
        <LoginSecuritySection />
        <OAuthProviderSection />
      </div>
    </div>
  )
}
