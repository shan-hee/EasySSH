
import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useSettingsForm } from "@/hooks/settings/use-settings-form"
import { aiConfigSchema, type AIConfigFormValues } from "@/schemas/settings/integrations.schema"
import { aiConfigApi, type AIConfig } from "@/lib/api/ai-config"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { FormInput, FormSelect, FormSwitch } from "@/components/settings/form-field"
import { AIModelSelector, parseAIModels } from "@/components/ai-agent/ai-model-selector"
import { toast } from "sonner"

type AIProvider = AIConfigFormValues["provider"]

const AI_PROVIDERS: AIProvider[] = ["openai", "openai-response", "gemini", "anthropic"]

function toFormValues(config: AIConfig): AIConfigFormValues {
  const provider = config.provider.toLowerCase() as AIProvider
  return {
    enabled: config.enabled,
    provider: AI_PROVIDERS.includes(provider) ? provider : "openai",
    api_key: "",
    endpoint: config.endpoint,
    models: config.models.join(","),
    has_api_key: config.has_api_key,
  }
}

export function AIConfigWrapper() {
  const { t } = useTranslation("settingsIntegrationsAI")
  const queryClient = useQueryClient()
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isProbingModels, setIsProbingModels] = useState(false)

  const providerOptions = [
    { label: t("providerOpenAI"), value: "openai" },
    { label: t("providerOpenAIResponse"), value: "openai-response" },
    { label: t("providerGemini"), value: "gemini" },
    { label: t("providerAnthropic"), value: "anthropic" },
  ]

  const { form, isLoading, isSaving } = useSettingsForm({
    cacheKey: "ai-config",
    schema: aiConfigSchema,
    loadFn: async () => toFormValues(await aiConfigApi.get()),
    saveFn: async (data) => {
      const apiKey = data.api_key?.trim()
      await aiConfigApi.save({
        enabled: data.enabled,
        provider: data.provider,
        endpoint: data.endpoint.trim(),
        models: parseAIModels(data.models),
        ...(apiKey ? { api_key: apiKey } : {}),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aiConfig"] })
    },
  })

  const provider = form.watch("provider")
  const endpoint = form.watch("endpoint")
  const apiKey = form.watch("api_key")

  useEffect(() => {
    setAvailableModels([])
  }, [provider, endpoint, apiKey])

  const handleProbeModels = async () => {
    setAvailableModels([])
    setIsProbingModels(true)
    try {
      const key = apiKey?.trim()
      const response = await aiConfigApi.probeModels({
        provider,
        endpoint: endpoint.trim(),
        ...(key ? { api_key: key } : {}),
      })
      const probed = Array.from(
        new Set(
          response.models.map((m) => m.trim()).filter((m) => m.length > 0),
        ),
      )
      setAvailableModels(probed)
      if (probed.length > 0) {
        toast.success(t("probeModelsSuccess", { count: probed.length }))
      } else {
        toast.info(t("noDetectedModels"))
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

  const hasApiKey = form.watch("has_api_key")

  return (
    <div className="space-y-4 p-4">
      <FormSwitch form={form} name="enabled" label={t("fieldEnabledLabel")} description={t("fieldEnabledDesc")} />

      {form.watch("enabled") && <>
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <FormSelect form={form} name="provider" label={t("fieldProviderLabel")} placeholder={t("fieldProviderPlaceholder")} options={providerOptions} />
          <FormInput form={form} name="endpoint" label={t("fieldApiEndpointLabel")} description={t("fieldApiEndpointDesc")} type="url" placeholder="https://api.openai.com/v1" />
        </div>
        <FormInput
          form={form}
          name="api_key"
          label={t("fieldApiKeyLabel")}
          description={hasApiKey ? t("fieldApiKeyDescConfigured") : t("fieldApiKeyDesc")}
          type="password"
          placeholder={hasApiKey ? "••••••••••••••••" : t("fieldApiKeyPlaceholder")}
        />
        <AIModelSelector
          value={form.watch("models")}
          availableModels={availableModels}
          onChange={(value) => form.setValue("models", value, {
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
      </>}
    </div>
  )
}
