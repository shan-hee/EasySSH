import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Globe, Info, Network, Plus, Shield, X } from "lucide-react"
import { settingsApi } from "@/lib/api/settings"
import { corsConfigSchema, webSecuritySchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsFormActions } from "@/components/settings/settings-form-actions"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSelect, FormTextarea } from "@/components/settings/form-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const schema = webSecuritySchema.merge(corsConfigSchema)

export function NetworkSecurityTab() {
  const { t } = useTranslation("settingsNetworkDeployment")
  const [originInput, setOriginInput] = useState("")
  const { form, isLoading, isSaving, handleSave } = useSettingsForm({
    schema,
    loadFn: async () => {
      const [webSecurity, cors, system] = await Promise.all([
        settingsApi.getWebSecurityConfig(),
        settingsApi.getCORSConfig(),
        settingsApi.getSystemConfig(),
      ])
      return {
        ...webSecurity,
        allowed_origins: cors.allowed_origins ?? [],
        geoip_database_path: system.geoip_database_path ?? "",
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveWebSecurityConfig({
        trusted_proxies: data.trusted_proxies,
        cookie_secure_mode: data.cookie_secure_mode,
        cookie_domain: data.cookie_domain,
        cookie_same_site: data.cookie_same_site,
        csrf_trusted_origins: data.csrf_trusted_origins,
        content_security_policy: data.content_security_policy,
      })
      await settingsApi.saveCORSConfig({ allowed_origins: data.allowed_origins })
      await settingsApi.saveRuntimeConfig({ geoip_database_path: data.geoip_database_path })
    },
  })

  if (isLoading) return <SettingsLoading />

  const addOrigin = () => {
    const origin = originInput.trim()
    if (!origin) return
    const origins = form.getValues("allowed_origins")
    if (!origins.includes(origin)) form.setValue("allowed_origins", [...origins, origin], { shouldDirty: true })
    setOriginInput("")
  }

  const removeOrigin = (origin: string) => {
    form.setValue("allowed_origins", form.getValues("allowed_origins").filter((item) => item !== origin), { shouldDirty: true })
  }

  const dirtyFields = form.formState.dirtyFields
  const proxyDirty = Boolean(dirtyFields.trusted_proxies)
  const cookieDirty = Boolean(dirtyFields.cookie_secure_mode || dirtyFields.cookie_domain || dirtyFields.cookie_same_site)
  const originDirty = Boolean(dirtyFields.allowed_origins || dirtyFields.csrf_trusted_origins)
  const browserPolicyDirty = Boolean(dirtyFields.content_security_policy)
  const geoIPDirty = Boolean(dirtyFields.geoip_database_path)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-custom">
        <div className="space-y-4">
          <SettingsSection
            title={t("proxyTitle")}
            description={t("proxyDescription")}
            icon={<Network className="h-5 w-5" />}
            actions={<SettingsFormActions visible={proxyDirty} isSaving={isSaving} onReset={() => form.resetField("trusted_proxies")} onSave={handleSave} />}
          >
            <FormTextarea form={form} name="trusted_proxies" label={t("trustedProxies")} description={t("trustedProxiesDescription")} rows={4} placeholder={"127.0.0.1\n::1\n10.0.0.0/8"} required />
            <Alert><Info className="h-4 w-4" /><AlertDescription>{t("restartRequired")}</AlertDescription></Alert>
          </SettingsSection>

          <SettingsSection
            title={t("cookieTitle")}
            description={t("cookieDescription")}
            icon={<Shield className="h-5 w-5" />}
            actions={<SettingsFormActions visible={cookieDirty} isSaving={isSaving} onReset={() => {
              form.resetField("cookie_secure_mode")
              form.resetField("cookie_domain")
              form.resetField("cookie_same_site")
            }} onSave={handleSave} />}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <FormSelect
                form={form}
                name="cookie_secure_mode"
                label={t("cookieSecureMode")}
                description={t("cookieSecureModeDescription")}
                options={[
                  { value: "auto", label: t("cookieSecureAuto") },
                  { value: "always", label: t("cookieSecureAlways") },
                  { value: "never", label: t("cookieSecureNever") },
                ]}
              />
              <FormSelect
                form={form}
                name="cookie_same_site"
                label="SameSite"
                options={[
                  { value: "lax", label: "Lax" },
                  { value: "strict", label: "Strict" },
                  { value: "none", label: "None" },
                ]}
              />
              <FormInput form={form} name="cookie_domain" label={t("cookieDomain")} description={t("cookieDomainDescription")} placeholder=".example.com" />
            </div>
          </SettingsSection>

          <SettingsSection
            title={t("originTitle")}
            description={t("originDescription")}
            icon={<Globe className="h-5 w-5" />}
            actions={<SettingsFormActions visible={originDirty} isSaving={isSaving} onReset={() => {
              form.resetField("allowed_origins")
              form.resetField("csrf_trusted_origins")
            }} onSave={handleSave} />}
          >
            <div className="space-y-3">
              <Label>{t("corsOrigins")}</Label>
              <div className="flex gap-2">
                <Input value={originInput} onChange={(event) => setOriginInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOrigin() } }} placeholder="https://admin.example.com" />
                <Button type="button" size="sm" onClick={addOrigin}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.watch("allowed_origins").map((origin) => (
                  <Badge key={origin} variant="secondary" className="gap-1">{origin}<button type="button" onClick={() => removeOrigin(origin)}><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("corsOriginsDescription")}</p>
            </div>
            <FormTextarea form={form} name="csrf_trusted_origins" label={t("csrfOrigins")} description={t("csrfOriginsDescription")} rows={4} placeholder="https://admin.example.com" />
          </SettingsSection>

          <SettingsSection
            title={t("browserPolicyTitle")}
            description={t("browserPolicyDescription")}
            icon={<Shield className="h-5 w-5" />}
            actions={<SettingsFormActions visible={browserPolicyDirty} isSaving={isSaving} onReset={() => form.resetField("content_security_policy")} onSave={handleSave} />}
          >
            <FormTextarea form={form} name="content_security_policy" label="Content-Security-Policy" description={t("cspDescription")} rows={7} placeholder={t("cspPlaceholder")} />
          </SettingsSection>

          <SettingsSection
            title={t("geoipTitle")}
            description={t("geoipDescription")}
            icon={<Globe className="h-5 w-5" />}
            actions={<SettingsFormActions visible={geoIPDirty} isSaving={isSaving} onReset={() => form.resetField("geoip_database_path")} onSave={handleSave} />}
          >
            <FormInput form={form} name="geoip_database_path" label={t("geoipPath")} description={t("geoipPathDescription")} placeholder="/var/lib/easyssh/GeoLite2-City.mmdb" />
            <Alert><Info className="h-4 w-4" /><AlertDescription>{t("restartRequired")}</AlertDescription></Alert>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
