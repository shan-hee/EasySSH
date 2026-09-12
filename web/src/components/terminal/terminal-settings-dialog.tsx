import { memo, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Download, Upload, Settings, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/sonner"
import { KeyboardShortcutInput } from "./keyboard-shortcut-input"
import { TerminalSettingsPreview } from "./terminal-settings-preview"
import { TERMINAL_SHORTCUT_KEYS, normalizeShortcut } from "./terminal-shortcuts"
import {
  DEFAULT_TERMINAL_SETTINGS,
  MAX_TERMINAL_BACKGROUND_BYTES,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_WEIGHTS,
  isTerminalBackgroundImage,
  normalizeTerminalSettings,
  parseTerminalSettingsImport,
  serializeTerminalSettingsExport,
  type TerminalSettings,
} from "./terminal-settings"

export type { TerminalSettings } from "./terminal-settings"

function SettingRow({
  id,
  label,
  help,
  children,
}: {
  id: string
  label: string
  help?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id}>{label}</Label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      {children}
    </div>
  )
}

interface TerminalSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: TerminalSettings
  inactiveReminderLimit?: number
  onSettingsChange: (settings: TerminalSettings) => void
}

export const TerminalSettingsDialog = memo(function TerminalSettingsDialog({
  open,
  onOpenChange,
  settings,
  inactiveReminderLimit = 1440,
  onSettingsChange,
}: TerminalSettingsDialogProps) {
  const { t } = useTranslation("terminalSettings")
  const [local, setLocal] = useState(settings)
  const [activeTab, setActiveTab] = useState("appearance")
  const [backgroundUrl, setBackgroundUrl] = useState("")
  const [pending, setPending] = useState<{ settings: TerminalSettings; imported: boolean } | null>(
    null,
  )
  const importRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const imageRequestRef = useRef(0)
  useEffect(() => {
    setLocal(settings)
    setBackgroundUrl(settings.backgroundImage.startsWith("data:") ? "" : settings.backgroundImage)
  }, [settings, open])
  useEffect(() => {
    if (!open) {
      setActiveTab("appearance")
      imageRequestRef.current++
      setPending(null)
    }
    const requests = imageRequestRef
    return () => {
      requests.current++
    }
  }, [open])
  const save = (next: TerminalSettings) => {
    try {
      onSettingsChange(
        normalizeTerminalSettings({
          ...next,
          inactiveMinutes:
            next.inactiveMinutes === 0 ? 0 : Math.min(next.inactiveMinutes, inactiveReminderLimit),
        }),
      )
      return true
    } catch {
      setLocal(settings)
      toast.error(t("saveFailed"))
      return false
    }
  }
  const update = <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) =>
    save({ ...local, [key]: value })
  const toggle = (
    key:
      | "cursorBlink"
      | "copyOnSelect"
      | "rightClickPaste"
      | "multiLinePasteWarning"
      | "autoReconnect"
      | "completionUseHistory"
      | "completionUseScripts"
      | "completionUseRemotePaths",
    label: string,
    help?: string,
  ) => (
    <SettingRow id={key} label={t(label)} help={help ? t(help) : undefined}>
      <Switch id={key} checked={local[key]} onCheckedChange={(value) => update(key, value)} />
    </SettingRow>
  )
  const choice = <K extends keyof TerminalSettings>(
    key: K,
    label: string,
    options: { value: string; label: string }[],
    help?: string,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={key}>{t(label)}</Label>
      <Select
        value={String(local[key])}
        onValueChange={(value) =>
          update(
            key,
            (typeof local[key] === "number" ? Number(value) : value) as TerminalSettings[K],
          )
        }
      >
        <SelectTrigger id={key}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help && <p className="text-xs text-muted-foreground">{t(help)}</p>}
    </div>
  )
  const applyBackground = async (value: string) => {
    const request = ++imageRequestRef.current
    if (!isTerminalBackgroundImage(value)) {
      toast.error(t("backgroundInvalid"))
      return
    }
    if (value) {
      const loaded = await new Promise<boolean>((resolve) => {
        const image = new Image()
        const finish = (ok: boolean) => {
          clearTimeout(timer)
          image.onload = null
          image.onerror = null
          resolve(ok)
        }
        const timer = window.setTimeout(() => finish(false), 10000)
        image.onload = () => finish(true)
        image.onerror = () => finish(false)
        image.src = value
      })
      if (request !== imageRequestRef.current) return
      if (!loaded) {
        toast.error(t("backgroundInvalid"))
        return
      }
    }
    // Use the current settings to avoid overwriting edits made while the image was loading.
    setBackgroundUrl(value.startsWith("data:") ? "" : value)
    onBackgroundReadyRef.current(value)
  }
  const onBackgroundReadyRef = useRef((value: string) => {
    update("backgroundImage", value)
  })
  onBackgroundReadyRef.current = (value) => {
    update("backgroundImage", value)
  }
  const exportSettings = () => {
    const url = URL.createObjectURL(
      new Blob([serializeTerminalSettingsExport(settings)], {
        type: "application/json;charset=utf-8",
      }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `easyssh-terminal-settings-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          dismissOnEscape
          className="flex h-[720px] max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden p-0 sm:max-w-3xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            titleRef.current?.focus()
          }}
        >
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("dialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex min-h-0 flex-1 flex-col px-6"
          >
            <TabsList className="grid h-auto w-full shrink-0 grid-cols-2 sm:grid-cols-4">
              {["appearance", "input", "session", "completion"].map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {t(`tab_${tab}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1 scrollbar-custom [scrollbar-gutter:stable]">
              <TabsContent value="appearance" className="m-0 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="fontSize">
                    {t("fontSizeLabel")} · {local.fontSize}px
                  </Label>
                  <Slider
                    id="fontSize"
                    min={8}
                    max={40}
                    step={1}
                    value={[local.fontSize]}
                    onValueChange={([fontSize]) =>
                      setLocal((current) => ({ ...current, fontSize }))
                    }
                    onValueCommit={([value]) => update("fontSize", value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>div]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
                  {choice(
                    "fontFamily",
                    "fontFamilyLabel",
                    TERMINAL_FONT_FAMILIES.map((font, index) => ({
                      value: font,
                      label:
                        font === "monospace"
                          ? t("systemMonospace")
                          : `${font} · ${t(index < 4 ? "fontBundled" : "fontSystem")}`,
                    })),
                    "fontHelp",
                  )}
                  {choice(
                    "fontWeight",
                    "fontWeightLabel",
                    TERMINAL_FONT_WEIGHTS.map(value => ({ value, label: t(`fontWeight${value}`) })),
                    "fontWeightHelp",
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>div]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
                  {choice(
                    "lineHeight",
                    "lineHeightLabel",
                    [1, 1.2, 1.4].map((value, index) => ({
                      value: String(value),
                      label: t(["lineHeightCompact", "lineHeightNormal", "lineHeightLoose"][index]),
                    })),
                  )}
                  {choice(
                    "theme",
                    "themeLabel",
                    ["default", "dark", "light", "solarized", "dracula"].map((value) => ({
                      value,
                      label: ["solarized", "dracula"].includes(value)
                        ? value === "solarized"
                          ? "Solarized"
                          : "Dracula"
                        : t(`themeOption${value[0].toUpperCase()}${value.slice(1)}`),
                    })),
                  )}
                  {choice(
                    "cursorStyle",
                    "cursorStyleLabel",
                    ["block", "underline", "bar"].map((value) => ({
                      value,
                      label: t(`cursorStyle${value[0].toUpperCase()}${value.slice(1)}`),
                    })),
                  )}
                </div>
                {toggle("cursorBlink", "cursorBlinkLabel")}
                <div className="space-y-2">
                  <Label>{t("previewLabel")}</Label>
                  {open && activeTab === "appearance" && (
                    <TerminalSettingsPreview settings={local} />
                  )}
                </div>
                <details className="rounded-lg border p-4">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <ChevronDown className="h-4 w-4" />
                    {t("backgroundImageLabel")}
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => imageRef.current?.click()}>
                        {t("backgroundChoose")}
                      </Button>
                      {local.backgroundImage && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            void applyBackground("")
                          }}
                        >
                          {t("backgroundRemove")}
                        </Button>
                      )}
                    </div>
                    <input
                      ref={imageRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ""
                        if (!file) return
                        if (
                          file.size > MAX_TERMINAL_BACKGROUND_BYTES ||
                          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                            file.type,
                          )
                        ) {
                          toast.error(t("backgroundFileHelp"))
                          return
                        }
                        const reader = new FileReader()
                        const request = ++imageRequestRef.current
                        reader.onload = () => {
                          if (
                            request === imageRequestRef.current &&
                            typeof reader.result === "string"
                          )
                            void applyBackground(reader.result)
                        }
                        reader.onerror = () => toast.error(t("backgroundInvalid"))
                        reader.readAsDataURL(file)
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t("backgroundFileHelp")}</p>
                    <Label htmlFor="backgroundUrl">{t("backgroundUrlLabel")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="backgroundUrl"
                        value={backgroundUrl}
                        onChange={(event) => setBackgroundUrl(event.target.value)}
                        placeholder="https://…"
                      />
                      <Button
                        variant="outline"
                        onClick={() => {
                          void applyBackground(backgroundUrl.trim())
                        }}
                      >
                        {t("backgroundApply")}
                      </Button>
                    </div>
                    {!!local.backgroundImage && (
                      <div className="space-y-2">
                        <Label htmlFor="backgroundImageOpacity">
                          {t("backgroundImageOpacityLabel")} · {local.backgroundImageOpacity}%
                        </Label>
                        <Slider
                          id="backgroundImageOpacity"
                          min={0}
                          max={100}
                          step={5}
                          value={[local.backgroundImageOpacity]}
                          onValueChange={([value]) =>
                            setLocal((current) => ({ ...current, backgroundImageOpacity: value }))
                          }
                          onValueCommit={([value]) => update("backgroundImageOpacity", value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("backgroundImageOpacityHelp")}
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </TabsContent>
              <TabsContent value="input" className="m-0 space-y-5">
                {toggle("copyOnSelect", "copyOnSelectLabel", "copyOnSelectDescription")}
                {toggle("rightClickPaste", "rightClickPasteLabel", "rightClickPasteDescription")}
                {toggle("multiLinePasteWarning", "multiLinePasteLabel", "multiLinePasteHelp")}
                <div className="space-y-4 border-t pt-4">
                  <p className="text-sm font-medium">{t("tabShortcuts")}</p>
                  {TERMINAL_SHORTCUT_KEYS.map((key) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={key}>{t(key)}</Label>
                      <KeyboardShortcutInput
                        id={key}
                        value={local[key]}
                        onChange={(value) => {
                          const normalized = normalizeShortcut(value)
                          if (normalized === null) {
                            toast.error(t("shortcutInvalid"))
                            return
                          }
                          if (
                            normalized &&
                            TERMINAL_SHORTCUT_KEYS.some(
                              (other) => other !== key && local[other] === normalized,
                            )
                          ) {
                            toast.error(t("shortcutConflict"))
                            return
                          }
                          update(key, normalized)
                        }}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">{t("shortcutHelp")}</p>
                  <p className="text-xs text-muted-foreground">{t("zoomHelp")}</p>
                </div>
              </TabsContent>
              <TabsContent value="session" className="m-0 space-y-5">
                {choice(
                  "scrollback",
                  "scrollbackLabel",
                  [1000, 5000, 10000].map((value) => ({
                    value: String(value),
                    label: t("scrollbackValue", { lines: value }),
                  })),
                  "scrollbackHelp",
                )}
                {choice(
                  "inactiveMinutes",
                  "inactiveMinutesLabel",
                  Array.from(
                    new Set([
                      0,
                      15,
                      30,
                      60,
                      120,
                      180,
                      local.inactiveMinutes,
                      Math.min(180, inactiveReminderLimit),
                    ]),
                  )
                    .filter((value) => value <= inactiveReminderLimit)
                    .sort((a, b) => a - b)
                    .map((value) => ({
                      value: String(value),
                      label: value ? t("inactiveMinutesValue", { minutes: value }) : t("disabled"),
                    })),
                  "inactiveHelp",
                )}
                {toggle("autoReconnect", "autoReconnectLabel", "autoReconnectDescription")}
              </TabsContent>
              <TabsContent value="completion" className="m-0 space-y-5">
                {choice(
                  "completionMode",
                  "completionModeLabel",
                  ["auto", "tab", "off"].map((value) => ({
                    value,
                    label: t(`completionMode${value[0].toUpperCase()}${value.slice(1)}`),
                  })),
                  `completionMode${local.completionMode[0].toUpperCase()}${local.completionMode.slice(1)}Help`,
                )}
                {local.completionMode !== "off" && (
                  <>
                    {toggle(
                      "completionUseHistory",
                      "completionUseHistoryLabel",
                      "completionUseHistoryDescription",
                    )}
                    {toggle(
                      "completionUseScripts",
                      "completionUseScriptsLabel",
                      "completionUseScriptsDescription",
                    )}
                    {toggle(
                      "completionUseRemotePaths",
                      "completionUseRemotePathsLabel",
                      "completionUseRemotePathsDescription",
                    )}
                  </>
                )}
              </TabsContent>
            </div>
          </Tabs>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setPending({ settings: DEFAULT_TERMINAL_SETTINGS, imported: false })}
            >
              {t("btnReset")}
            </Button>
            <div className="flex flex-wrap gap-2">
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (!file) return
                  const request = imageRequestRef.current
                  try {
                    if (file.size > MAX_TERMINAL_BACKGROUND_BYTES * 1.5)
                      throw new Error("file_too_large")
                    const imported = parseTerminalSettingsImport(await file.text())
                    if (request === imageRequestRef.current)
                      setPending({ settings: imported, imported: true })
                  } catch {
                    toast.error(t("importFailed"))
                  }
                }}
              />
              <Button variant="outline" onClick={() => importRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                {t("btnImport")}
              </Button>
              <Button variant="outline" onClick={exportSettings}>
                <Download className="mr-2 h-4 w-4" />
                {t("btnExport")}
              </Button>
              <Button onClick={() => onOpenChange(false)}>{t("btnDone")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!pending}
        onOpenChange={(value) => {
          if (!value) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(pending?.imported ? "importConfirmTitle" : "resetConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("replaceConfirmHelp", {
                count: pending
                  ? Object.keys(settings).filter(
                      (key) =>
                        settings[key as keyof TerminalSettings] !==
                        pending.settings[key as keyof TerminalSettings],
                    ).length
                  : 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("btnCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                imageRequestRef.current++
                if (pending && save(pending.settings))
                  toast.success(t(pending.imported ? "importSuccess" : "resetSuccess"))
              }}
            >
              {t("btnConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})
