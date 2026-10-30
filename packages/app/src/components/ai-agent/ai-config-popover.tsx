import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Settings2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AIModelSelector, parseAIModels } from "@/components/ai-agent/ai-model-selector"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsPanel, SettingsPanelToggle } from "@/components/assistant-ui/elements/settings-panel"
import { toast } from "@/components/ui/sonner"
import {
  aiConfigApi,
  type AIConfig,
  type AIConfigInput,
  type AIModelsProbeInput,
  type AIModelsProbeResult,
} from "@/lib/api/ai-config"

/** 宿主提供的 AI 服务配置读写；未提供时使用实例的所有者接口。 */
export interface AIAssistantConfigAdapter {
  queryKey?: unknown[]
  getConfig: () => Promise<AIConfig>
  saveConfig: (config: AIConfigInput) => Promise<AIConfig>
  probeModels: (input: AIModelsProbeInput) => Promise<AIModelsProbeResult>
}

interface AIAssistantConfigPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  onSaved?: () => void
  adapter?: AIAssistantConfigAdapter
  side?: "bottom" | "right"
}

interface AIConfigForm {
  enabled: boolean
  provider: string
  api_key: string
  endpoint: string
  models: string
}

const DEFAULT_FORM: AIConfigForm = {
  enabled: true,
  provider: "openai",
  api_key: "",
  endpoint: "",
  models: ""
}

function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error && typeof error === "object") {
    if ("detail" in error) {
      const detail = error.detail
      if (typeof detail === "string") {
        return detail
      }
      if (detail && typeof detail === "object") {
        if ("message" in detail && typeof detail.message === "string") {
          return detail.message
        }
        if ("error" in detail && typeof detail.error === "string") {
          return detail.error
        }
      }
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message
    }
  }
  return defaultMessage
}

function toForm(config: AIConfig): AIConfigForm {
  return {
    enabled: config.enabled,
    provider: config.provider || "openai",
    api_key: "",
    endpoint: config.endpoint || "",
    models: config.models.join(",")
  }
}

export function AIAssistantConfigPopover({
  open,
  onOpenChange,
  trigger,
  onSaved,
  adapter,
  side = "bottom"
}: AIAssistantConfigPopoverProps) {
  const { t } = useTranslation("aiAssistant")
  const { t: tAccount } = useTranslation("accountSettings")
  const queryClient = useQueryClient()

  const [config, setConfig] = useState<AIConfig | null>(null)
  const [form, setForm] = useState<AIConfigForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [probingModels, setProbingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])

  const providerOptions = useMemo(
    () => [
      { value: "openai", label: tAccount("aiProviderOpenAI") },
      { value: "openai-response", label: tAccount("aiProviderOpenAIResponse") },
      { value: "gemini", label: tAccount("aiProviderGemini") },
      { value: "anthropic", label: tAccount("aiProviderAnthropic") }
    ],
    [tAccount]
  )

  useEffect(() => {
    setAvailableModels([])
  }, [form.provider, form.api_key, form.endpoint])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const nextConfig = await (adapter?.getConfig ?? aiConfigApi.get)()
      setConfig(nextConfig)
      setForm(toForm(nextConfig))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("aiConfigLoadFailed")))
    } finally {
      setLoading(false)
    }
  }, [adapter, t])

  useEffect(() => {
    if (open) {
      void loadConfig()
    }
  }, [loadConfig, open])

  const saveConfig = async () => {
    const models = parseAIModels(form.models)
    if (form.enabled) {
      if (!form.api_key.trim() && !config?.has_api_key) {
        toast.error(t("aiConfigAPIKeyRequired"))
        return
      }
      if (models.length === 0) {
        toast.error(t("aiConfigModelsRequired"))
        return
      }
    }

    setSaving(true)
    try {
      const apiKey = form.api_key.trim()
      const saved = await (adapter?.saveConfig ?? aiConfigApi.save)({
        enabled: form.enabled,
        provider: form.provider,
        endpoint: form.endpoint.trim(),
        models,
        ...(apiKey ? { api_key: apiKey } : {})
      })
      setConfig(saved)
      setForm(toForm(saved))
      toast.success(t("aiConfigSaveSuccess"))
      await queryClient.invalidateQueries({ queryKey: adapter?.queryKey ?? ["aiConfig"] })
      onSaved?.()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("aiConfigSaveFailed")))
    } finally {
      setSaving(false)
    }
  }

  const probeModels = async () => {
    setAvailableModels([])
    setProbingModels(true)
    try {
      const apiKey = form.api_key.trim()
      const response = await (adapter?.probeModels ?? aiConfigApi.probeModels)({
        provider: form.provider,
        endpoint: form.endpoint.trim(),
        ...(apiKey ? { api_key: apiKey } : {})
      })
      const models = Array.from(new Set(response.models.map((model) => model.trim()).filter(Boolean)))
      setAvailableModels(models)
      if (models.length > 0) {
        toast.success(t("aiConfigProbeModelsSuccess", { count: models.length }))
      } else {
        toast.info(t("aiConfigProbeModelsEmpty"))
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("aiConfigProbeModelsFailed")))
    } finally {
      setProbingModels(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={side === "right" ? "start" : "end"}
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[calc(var(--radius)+8px)] border-border bg-popover p-0 shadow-2xl"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t("aiConfigPanelTitle")}</h3>
          </div>
        </div>

        {loading || !config ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("aiConfigLoading")}</span>
          </div>
        ) : (
          <SettingsPanel className="max-h-[70vh] overflow-y-auto rounded-none border-0 scrollbar-custom">
            <div className="border-b border-border/60 pb-4">
              <SettingsPanelToggle
                label={t("aiConfigEnabled")}
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="assistant-ai-provider" className="text-xs">
                  {tAccount("aiProviderLabel")}
                </Label>
                <Select
                  value={form.provider}
                  onValueChange={(value) => setForm((current) => ({ ...current, provider: value }))}
                  disabled={saving}
                >
                  <SelectTrigger id="assistant-ai-provider" className="h-8 text-xs">
                    <SelectValue placeholder={tAccount("aiProviderPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="assistant-ai-api-key" className="text-xs">
                    {tAccount("aiAPIKeyLabel")}
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    {config.has_api_key ? tAccount("aiAPIKeySet") : tAccount("aiAPIKeyNotSet")}
                  </span>
                </div>
                <Input
                  id="assistant-ai-api-key"
                  type="password"
                  className="h-8 text-xs"
                  placeholder={tAccount("aiAPIKeyPlaceholder")}
                  value={form.api_key}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, api_key: event.target.value }))
                  }
                  disabled={saving}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="assistant-ai-endpoint" className="text-xs">
                  {tAccount("aiEndpointLabel")}
                </Label>
                <Input
                  id="assistant-ai-endpoint"
                  className="h-8 text-xs"
                  placeholder={tAccount("aiEndpointPlaceholder")}
                  value={form.endpoint}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, endpoint: event.target.value }))
                  }
                  disabled={saving}
                />
              </div>

              <AIModelSelector
                value={form.models}
                availableModels={availableModels}
                onChange={(value) => setForm((current) => ({ ...current, models: value }))}
                onProbe={() => void probeModels()}
                probing={probingModels}
                disabled={saving}
                compact
                labels={{
                  label: tAccount("aiModelsLabel"),
                  manualPlaceholder: tAccount("aiModelsPlaceholder"),
                  probe: t("aiConfigProbeModels"),
                  probing: t("aiConfigProbingModels"),
                  clear: t("aiConfigClearModels"),
                  selectPlaceholder: t("aiConfigModelSelectPlaceholder"),
                  selectSummary: (availableCount, selectedCount) =>
                    t("aiConfigModelSelectSummary", { availableCount, selectedCount }),
                  noOptions: t("aiConfigModelSelectNoOptions"),
                  createModel: (value) => t("aiConfigModelSelectCreate", { value })
                }}
              />
            </div>

            <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
              <Button type="button" size="sm" onClick={() => void saveConfig()} disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                {t("aiConfigSaveButton")}
              </Button>
            </div>
          </SettingsPanel>
        )}
      </PopoverContent>
    </Popover>
  )
}
