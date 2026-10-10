import { useEffect, useId, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Globe, Loader2, Monitor, SlidersHorizontal, Unplug, toast } from "@easyssh/ssh-workspace/desktop"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import {
  defaultDesktopProxyConfig,
  isValidDesktopProxyCredentials,
  isValidDesktopProxyURL,
  loadDesktopProxyConfig,
  saveDesktopProxyConfig,
  type DesktopProxyConfig,
  type DesktopProxyMode,
} from "../adapters/desktop-proxy"

const proxyModes = [
  { value: "system", icon: Monitor, title: "proxySystemLabel", description: "proxySystemDescription" },
  { value: "direct", icon: Unplug, title: "proxyDirectLabel", description: "proxyDirectDescription" },
  { value: "manual", icon: SlidersHorizontal, title: "proxyManualLabel", description: "proxyManualDescription" },
] as const

export function DesktopProxyDialog({ onOpenChange, platform }: {
  onOpenChange: (open: boolean) => void
  platform?: string
}) {
  const { t } = useTranslation("desktop")
  const id = useId()
  const [config, setConfig] = useState<DesktopProxyConfig>(defaultDesktopProxyConfig)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void loadDesktopProxyConfig().then((next) => {
      if (active) setConfig(next)
    }).catch(() => {
      if (active) setLoadFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const invalidURL = config.mode === "manual" && !isValidDesktopProxyURL(config.url)
  const invalidCredentials = !isValidDesktopProxyCredentials(config)
  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || loadFailed || saving || invalidURL || invalidCredentials) return
    setSaving(true)
    setError("")
    try {
      await saveDesktopProxyConfig(config)
      toast.success(t("proxySavedMessage"))
      onOpenChange(false)
    } catch {
      setError(t("proxySaveFailedMessage"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!saving) onOpenChange(open) }}>
      <DialogContent showCloseButton={!saving} dismissOnEscape={!saving} className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[520px] [--wails-draggable:no-drag]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5 text-muted-foreground" />
            {t("networkProxyLabel")}
          </DialogTitle>
          <DialogDescription>{t("proxyDialogDescription")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />{t("proxyLoadingLabel")}
          </div>
        ) : loadFailed ? (
          <p className="py-4 text-sm text-destructive" role="alert">{t("proxyLoadFailedMessage")}</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <RadioGroup aria-label={t("proxyModeLabel")} value={config.mode} disabled={saving}
              onValueChange={(mode) => { setConfig((current) => ({ ...current, mode: mode as DesktopProxyMode })); setError("") }}>
              {proxyModes.map(({ value, icon: Icon, title, description }) => (
                <label key={value} htmlFor={`${id}-${value}`} className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent/50",
                  config.mode === value ? "border-primary/50 bg-primary/5" : "border-border",
                  saving && "pointer-events-none opacity-60",
                )}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t(title)}
                      {value === "system" && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{t("proxyDefaultLabel")}</span>}
                    </span>
                    <span className="block text-xs leading-5 text-muted-foreground">{t(value === "system" && platform !== "windows" ? "proxySystemEnvironmentDescription" : description)}</span>
                  </span>
                  <RadioGroupItem id={`${id}-${value}`} value={value} />
                </label>
              ))}
            </RadioGroup>
            {config.mode === "manual" && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-url`}>{t("proxyAddressLabel")}</Label>
                <Input id={`${id}-url`} value={config.url} disabled={saving} placeholder="http://127.0.0.1:7890"
                  autoComplete="off" spellCheck={false} aria-invalid={config.url !== "" && invalidURL}
                  aria-describedby={`${id}-hint`} onChange={(event) => {
                    setConfig((current) => ({ ...current, url: event.target.value, password: "", hasPassword: false, passwordSet: true }))
                    setError("")
                  }} />
                <p id={`${id}-hint`} className={cn("text-xs leading-5", config.url !== "" && invalidURL ? "text-destructive" : "text-muted-foreground")}>
                  {t("proxyAddressHint")}
                </p>
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-username`}>{t("proxyUsernameLabel")}</Label>
                    <Input id={`${id}-username`} value={config.username} disabled={saving}
                      autoComplete="off" autoCapitalize="none" spellCheck={false}
                      placeholder={t("proxyUsernamePlaceholder")} aria-describedby={`${id}-auth-hint`}
                      aria-invalid={invalidCredentials}
                      onChange={(event) => {
                        setConfig((current) => ({ ...current, username: event.target.value, password: "", hasPassword: false, passwordSet: true }))
                        setError("")
                      }} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-password`}>{t("proxyPasswordLabel")}</Label>
                    <Input id={`${id}-password`} type="password" value={config.password}
                      disabled={saving || !config.username} autoComplete="new-password"
                      placeholder={t(config.hasPassword && !config.passwordSet ? "proxyPasswordSavedPlaceholder" : "proxyPasswordPlaceholder")}
                      aria-describedby={`${id}-auth-hint`} aria-invalid={invalidCredentials}
                      onChange={(event) => {
                        setConfig((current) => ({ ...current, password: event.target.value, passwordSet: true }))
                        setError("")
                      }} />
                  </div>
                </div>
                <p id={`${id}-auth-hint`} className={cn("text-xs leading-5", invalidCredentials ? "text-destructive" : "text-muted-foreground")}>
                  {t(invalidCredentials ? "proxyCredentialsInvalidMessage" : "proxyAuthenticationHint")}
                </p>
                {config.hasPassword && (
                  <Button type="button" variant="ghost" size="sm" disabled={saving}
                    onClick={() => {
                      setConfig((current) => ({ ...current, username: "", password: "", passwordSet: true, hasPassword: false }))
                      setError("")
                    }}>{t("proxyClearCredentialsLabel")}</Button>
                )}
              </div>
            )}
            <p className="rounded-md bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">{t("proxyScopeDescription")}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("proxyCancelLabel")}</Button>
              <Button type="submit" disabled={saving || invalidURL || invalidCredentials}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t(saving ? "proxySavingLabel" : "proxySaveLabel")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
