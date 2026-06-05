import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Bot, CheckCircle2, Loader2, Settings2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/sonner"
import { userAIConfigApi, type UserAIConfig } from "@/lib/api/settings"
import type { SaveUserAIConfigRequest } from "@/lib/api/settings"
import { cn } from "@/lib/utils"

export interface AIAssistantConfigAdapter {
  queryKey?: unknown[]
  getUserAIConfig: () => Promise<UserAIConfig>
  saveUserAIConfig: (config: SaveUserAIConfigRequest) => Promise<void>
}

interface AIAssistantConfigPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  onSaved?: () => void
  customConfigOnly?: boolean
  adapter?: AIAssistantConfigAdapter
}

interface AIConfigForm {
  use_system_config: boolean
  custom_enabled: boolean
  custom_provider: string
  custom_api_key: string
  custom_endpoint: string
  custom_models: string
}

const DEFAULT_FORM: AIConfigForm = {
  use_system_config: true,
  custom_enabled: false,
  custom_provider: "openai",
  custom_api_key: "",
  custom_endpoint: "",
  custom_models: "",
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

function toForm(config: UserAIConfig, customConfigOnly = false): AIConfigForm {
  return {
    use_system_config: customConfigOnly ? false : config.use_system_config,
    custom_enabled: customConfigOnly ? true : config.custom_enabled,
    custom_provider: config.custom_provider || "openai",
    custom_api_key: "",
    custom_endpoint: config.custom_endpoint || "",
    custom_models: config.custom_models || "",
  }
}

export function AIAssistantConfigPopover({
  open,
  onOpenChange,
  trigger,
  onSaved,
  customConfigOnly = false,
  adapter,
}: AIAssistantConfigPopoverProps) {
  const { t } = useTranslation("aiAssistant")
  const { t: tAccount } = useTranslation("accountSettings")
  const queryClient = useQueryClient()

  const [config, setConfig] = useState<UserAIConfig | null>(null)
  const [form, setForm] = useState<AIConfigForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const providerOptions = useMemo(
    () => [
      { value: "openai", label: tAccount("aiProviderOpenAI") },
      { value: "openai-response", label: tAccount("aiProviderOpenAIResponse") },
      { value: "gemini", label: tAccount("aiProviderGemini") },
      { value: "anthropic", label: tAccount("aiProviderAnthropic") },
    ],
    [tAccount]
  )

  const isSystemActive = !customConfigOnly && form.use_system_config
  const isCustomActive = customConfigOnly || (!form.use_system_config && form.custom_enabled)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const nextConfig = await (adapter?.getUserAIConfig ?? userAIConfigApi.getUserAIConfig)()
      setConfig(nextConfig)
      setForm(toForm(nextConfig, customConfigOnly))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("aiConfigLoadFailed")))
    } finally {
      setLoading(false)
    }
  }, [adapter, customConfigOnly, t])

  useEffect(() => {
    if (open) {
      void loadConfig()
    }
  }, [loadConfig, open])

  const setSystemEnabled = (checked: boolean) => {
    setForm((current) => ({
      ...current,
      use_system_config: checked,
      custom_enabled: !checked,
    }))
  }

  const setCustomEnabled = (checked: boolean) => {
    setForm((current) => ({
      ...current,
      use_system_config: customConfigOnly ? false : !checked,
      custom_enabled: customConfigOnly ? true : checked,
    }))
  }

  const saveConfig = async () => {
    if (isCustomActive) {
      if (!form.custom_api_key.trim() && !config?.has_api_key) {
        toast.error(t("aiConfigAPIKeyRequired"))
        return
      }
      if (!form.custom_models.trim()) {
        toast.error(t("aiConfigModelsRequired"))
        return
      }
    }

    setSaving(true)
    try {
      await (adapter?.saveUserAIConfig ?? userAIConfigApi.saveUserAIConfig)({
        use_system_config: customConfigOnly ? false : form.use_system_config,
        custom_enabled: customConfigOnly ? true : form.custom_enabled,
        custom_provider: form.custom_provider,
        custom_api_key: form.custom_api_key.trim(),
        custom_endpoint: form.custom_endpoint.trim(),
        custom_models: form.custom_models.trim(),
      })
      toast.success(t("aiConfigSaveSuccess"))
      await loadConfig()
      await queryClient.invalidateQueries({ queryKey: adapter?.queryKey ?? ["aiConfig"] })
      onSaved?.()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("aiConfigSaveFailed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border-zinc-200/80 p-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t("aiConfigPanelTitle")}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("aiConfigPanelDescription")}
          </p>
        </div>

        {loading || !config ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("aiConfigLoading")}</span>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-3 scrollbar-custom">
            <div className="space-y-2">
              {!customConfigOnly && (
                <div
                  className={cn(
                    "rounded-md border bg-card transition-colors",
                    isSystemActive && "border-primary/40 bg-primary/5"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Settings2 className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-medium">
                            {t("aiConfigSystemTitle")}
                          </h4>
                          {isSystemActive && (
                            <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("aiConfigSystemDescription")}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={isSystemActive}
                      onCheckedChange={setSystemEnabled}
                      disabled={saving}
                      aria-label={t("aiConfigSystemTitle")}
                    />
                  </div>
                </div>
              )}

              <div
                className={cn(
                  "rounded-md border bg-card transition-colors",
                  isCustomActive && "border-primary/40 bg-primary/5"
                )}
              >
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Bot className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium">
                          {t("aiConfigCustomTitle")}
                        </h4>
                        {isCustomActive && (
                          <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("aiConfigCustomDescription")}
                      </p>
                    </div>
                  </div>
                  {!customConfigOnly && (
                    <Switch
                      checked={isCustomActive}
                      onCheckedChange={setCustomEnabled}
                      disabled={saving}
                      aria-label={t("aiConfigCustomTitle")}
                    />
                  )}
                </div>

                <div className="space-y-3 border-t border-border/60 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="assistant-ai-provider" className="text-xs">
                      {tAccount("aiProviderLabel")}
                    </Label>
                    <Select
                      value={form.custom_provider}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, custom_provider: value }))
                      }
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
                    <Label htmlFor="assistant-ai-api-key" className="text-xs">
                      {tAccount("aiAPIKeyLabel")}
                    </Label>
                    <Input
                      id="assistant-ai-api-key"
                      type="password"
                      className="h-8 text-xs"
                      placeholder={tAccount("aiAPIKeyPlaceholder")}
                      value={form.custom_api_key}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, custom_api_key: event.target.value }))
                      }
                      disabled={saving}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {config.has_api_key ? tAccount("aiAPIKeySet") : tAccount("aiAPIKeyNotSet")}
                      {" · "}
                      {tAccount("aiAPIKeyHint")}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="assistant-ai-endpoint" className="text-xs">
                      {tAccount("aiEndpointLabel")}
                    </Label>
                    <Input
                      id="assistant-ai-endpoint"
                      className="h-8 text-xs"
                      placeholder={tAccount("aiEndpointPlaceholder")}
                      value={form.custom_endpoint}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, custom_endpoint: event.target.value }))
                      }
                      disabled={saving}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {tAccount("aiEndpointHint")}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="assistant-ai-models" className="text-xs">
                      {tAccount("aiModelsLabel")}
                    </Label>
                    <Input
                      id="assistant-ai-models"
                      className="h-8 text-xs"
                      placeholder={tAccount("aiModelsPlaceholder")}
                      value={form.custom_models}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, custom_models: event.target.value }))
                      }
                      disabled={saving}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {tAccount("aiModelsHint")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
              <Button
                type="button"
                size="sm"
                onClick={() => void saveConfig()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                {t("aiConfigSaveButton")}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
