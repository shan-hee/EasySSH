import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, X } from "lucide-react"
import { settingsApi } from "@/lib/api/settings"
import { corsConfigSchema, webSecuritySchema } from "@/schemas/settings/security.schema"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsSection } from "@/components/settings/settings-section"
import { FormInput, FormSelect, FormTextarea } from "@/components/settings/form-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const schema = webSecuritySchema.merge(corsConfigSchema)

export function NetworkSecurityTab() {
  const { t } = useTranslation("settingsNetworkDeployment")
  const [originInput, setOriginInput] = useState("")
  const { form, isLoading } = useSettingsForm({
    cacheKey: "network-security",
    schema,
    loadFn: async () => {
      const [webSecurity, cors] = await Promise.all([
        settingsApi.getWebSecurityConfig(),
        settingsApi.getCORSConfig(),
      ])
      return {
        ...webSecurity,
        allowed_origins: cors.allowed_origins ?? [],
      }
    },
    saveFn: async (data) => {
      await settingsApi.saveWebSecurityConfig({
        trusted_proxies: data.trusted_proxies,
        cookie_secure_mode: data.cookie_secure_mode,
        cookie_domain: data.cookie_domain,
        cookie_same_site: data.cookie_same_site,
        content_security_policy: data.content_security_policy,
      })
      await settingsApi.saveCORSConfig({ allowed_origins: data.allowed_origins })
    },
  })

  if (isLoading) return <SettingsLoading />

  const addOrigin = () => {
    const origin = originInput.trim()
    if (!origin) return
    const origins = form.getValues("allowed_origins") ?? []
    if (!origins.includes(origin)) form.setValue("allowed_origins", [...origins, origin], { shouldDirty: true })
    setOriginInput("")
  }

  const removeOrigin = (origin: string) => {
    const origins = form.getValues("allowed_origins") ?? []
    form.setValue("allowed_origins", origins.filter((item) => item !== origin), { shouldDirty: true })
  }

  const allowedOrigins = form.watch("allowed_origins") ?? []

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t("proxyTitle")} description={t("proxyDescription")}>
        <FormTextarea form={form} name="trusted_proxies" label={t("trustedProxies")} description={`${t("trustedProxiesDescription")} ${t("restartRequired")}`} rows={4} placeholder={"127.0.0.1\n::1\n10.0.0.0/8"} required />
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("cookieTitle")} description={t("cookieDescription")}>
        <div className="grid gap-4 lg:grid-cols-3">
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

      <div className="border-t" />

      <SettingsSection title={t("originTitle")} description={t("originDescription")}>
        <div className="space-y-1.5">
          <Label htmlFor="cors-origin">{t("corsOrigins")}</Label>
          <div className="flex gap-2">
            <Input id="cors-origin" value={originInput} onChange={(event) => setOriginInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOrigin() } }} placeholder="https://admin.example.com" />
            <Button type="button" variant="outline" size="icon" aria-label={t("addOrigin")} onClick={addOrigin}><Plus className="size-4" /></Button>
          </div>
          {allowedOrigins.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">
            {allowedOrigins.map((origin) => (
              <Badge key={origin} variant="secondary" className="gap-1 pr-1 font-normal">{origin}<button type="button" className="rounded-sm opacity-60 hover:opacity-100" aria-label={t("removeOrigin", { origin })} onClick={() => removeOrigin(origin)}><X className="size-3" /></button></Badge>
            ))}
          </div>}
          <p className="text-xs text-muted-foreground">{t("corsOriginsDescription")}</p>
        </div>
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("browserPolicyTitle")} description={t("browserPolicyDescription")}>
        <FormTextarea form={form} name="content_security_policy" label="Content-Security-Policy" description={t("cspDescription")} rows={6} placeholder={t("cspPlaceholder")} />
      </SettingsSection>
    </div>
  )
}
