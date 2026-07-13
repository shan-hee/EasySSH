
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { aiSystemConfigSchema } from "@/schemas/settings/integrations.schema"
import { settingsApi, type AISystemProvider } from "@/lib/api/settings"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { FormInput, FormSwitch } from "@/components/settings/form-field"
import { AIModelSelector } from "@/components/ai-agent/ai-model-selector"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, Save, Loader2, RotateCcw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { InfoIcon } from "lucide-react"
import { toast } from "sonner"

export function AIConfigWrapper() {
  const { t } = useTranslation("settingsIntegrationsAI")
  const { t: tCommon } = useTranslation("common")
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isProbingModels, setIsProbingModels] = useState(false)

  const providerOptions: Array<{ label: string; value: AISystemProvider }> = [
    { label: t("providerOpenAI"), value: "openai" },
    { label: t("providerOpenAIResponse"), value: "openai-response" },
    { label: t("providerGemini"), value: "gemini" },
    { label: t("providerAnthropic"), value: "anthropic" },
  ]

  const { form, isLoading, isSaving, handleSave, reload } = useSettingsForm({
    schema: aiSystemConfigSchema,
    loadFn: async () => {
      const systemConfig = await settingsApi.getAISystemConfig()
      return systemConfig
    },
    saveFn: async (data) => {
      await settingsApi.saveAISystemConfig({
        system_enabled: data.system_enabled,
        system_provider: data.system_provider,
        system_api_key: data.system_api_key,
        system_api_endpoint: data.system_api_endpoint,
        system_models: data.system_models,
      })
    },
  })

  const provider = form.watch("system_provider")
  const endpoint = form.watch("system_api_endpoint")
  const apiKey = form.watch("system_api_key")

  useEffect(() => {
    setAvailableModels([])
  }, [provider, endpoint, apiKey])

  const handleProbeModels = async () => {
    setAvailableModels([])
    setIsProbingModels(true)
    try {
      const response = await settingsApi.probeAISystemModels({
        system_provider: provider,
        system_api_key: apiKey?.trim() || "",
        system_api_endpoint: endpoint?.trim() || "",
      })
      const probed = Array.from(
        new Set(
          (response.models || []).map((m) => m.trim()).filter((m) => m.length > 0),
        ),
      )
      setAvailableModels(probed)
      if (probed.length > 0) {
        toast.success(t("probeModelsSuccess", { count: probed.length }))
      } else {
        toast.info(response.message || t("noDetectedModels"))
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("probeModelsFailed")
      toast.error(msg)
    } finally {
      setIsProbingModels(false)
    }
  }

  if (isLoading) {
    return <SettingsLoading />
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-4">
        <div className="space-y-4">
          <SettingsSection
            title={t("sectionTitle")}
            description={t("sectionDescription")}
            icon={<Bot className="h-5 w-5" />}
          >
            <FormSwitch
              form={form}
              name="system_enabled"
              label={t("fieldSystemEnabledLabel")}
              description={t("fieldSystemEnabledDesc")}
            />

            {form.watch("system_enabled") && (
              <>
                <div className="space-y-2">
                  <Label>{t("fieldProviderLabel")}</Label>
                  <Select
                    value={form.watch("system_provider")}
                    onValueChange={(val) =>
                      form.setValue(
                        "system_provider",
                        val as AISystemProvider,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("fieldProviderPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {providerOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FormInput
                  form={form}
                  name="system_api_endpoint"
                  label={t("fieldApiEndpointLabel")}
                  description={t("fieldApiEndpointDesc")}
                  type="url"
                  placeholder="https://api.openai.com/v1"
                />

                <FormInput
                  form={form}
                  name="system_api_key"
                  label={t("fieldApiKeyLabel")}
                  description={form.watch("has_api_key") ? t("fieldApiKeyDescConfigured") : t("fieldApiKeyDesc")}
                  type="password"
                  placeholder={form.watch("has_api_key") ? "••••••••••••••••" : t("fieldApiKeyPlaceholder")}
                />

                <AIModelSelector
                  value={form.watch("system_models") || ""}
                  availableModels={availableModels}
                  onChange={(value) => form.setValue("system_models", value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })}
                  onProbe={() => void handleProbeModels()}
                  probing={isProbingModels}
                  disabled={isSaving}
                  labels={{
                    label: t("fieldModelsLabel"),
                    manualPlaceholder: t("fieldModelsPlaceholder"),
                    probe: t("probeModels"),
                    probing: t("probingModels"),
                    clear: t("clearModels"),
                    selectPlaceholder: t("modelSelectPlaceholder"),
                    selectSummary: (availableCount, selectedCount) =>
                      t("modelSelectSummary", { availableCount, selectedCount }),
                    noOptions: t("modelSelectNoOptions"),
                    createModel: (value) => t("modelSelectCreate", { value }),
                  }}
                />
              </>
            )}

            <Alert>
              <InfoIcon className="h-4 w-4" />
              <AlertDescription>
                {t("alertDescription")}
              </AlertDescription>
            </Alert>
          </SettingsSection>
        </div>
      </div>

      <div className="shrink-0 flex justify-end gap-2 p-4 bg-background">
        <Button variant="outline" onClick={reload} disabled={isSaving}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {tCommon("reset")}
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tCommon("saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {tCommon("save")}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
