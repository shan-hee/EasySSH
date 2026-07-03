import type { CompletionConfig, SourceQuotaConfig } from "@/lib/completion/types"
import { DEFAULT_COMPLETION_CONFIG } from "@/lib/completion/types"
import type { CompletionFetchOptions } from "@/lib/websocket-terminal"

export const TERMINAL_SETTINGS_STORAGE_KEY = "terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_SCHEMA = "easyssh.terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_VERSION = 1

export interface TerminalCompletionProviders {
  local: boolean
  remoteHistory: boolean
  script: boolean
  session: boolean
}

export interface TerminalCompletionQuotas {
  localMin: number
  localMax: number
  scriptMin: number
  scriptMax: number
  sessionMin: number
  sessionMax: number
  remoteHistoryUnlimited: boolean
  remoteHistorySoftMax: number
}

export interface TerminalCompletionCache {
  ttlMinutes: number
  maxEntries: number
}

export interface TerminalSettings {
  // 终端设置
  fontSize: number
  fontFamily: string
  cursorStyle: "block" | "underline" | "bar"
  cursorBlink: boolean
  scrollback: number
  rightClickPaste: boolean
  copyOnSelect: boolean

  // 主题设置
  theme: "default" | "dark" | "light" | "solarized" | "dracula"
  opacity: number
  backgroundImage: string
  backgroundImageOpacity: number
  backgroundImageOverlayOpacity: number

  // 行为设置
  maxTabs: number
  inactiveMinutes: number
  hibernateBackground: boolean
  autoReconnect: boolean
  confirmBeforeClose: boolean
  monitorInterval: number

  // 快捷键设置
  copyShortcut: string
  pasteShortcut: string
  clearShortcut: string

  // 补全设置
  completionEnabled: boolean
  completionTrigger: "tab" | "auto"
  completionAutoDelay: number
  completionMaxItems: number
  completionShowIcon: boolean
  completionShowDescription: boolean
  completionProviders: TerminalCompletionProviders
  completionQuotas: TerminalCompletionQuotas
  completionCache: TerminalCompletionCache
}

export interface TerminalSettingsExportPayload {
  schema: typeof TERMINAL_SETTINGS_EXPORT_SCHEMA
  version: typeof TERMINAL_SETTINGS_EXPORT_VERSION
  exported_at: string
  settings: TerminalSettings
}

export interface TerminalCompletionProviderFlags {
  local: boolean
  session: boolean
  script: boolean
  remoteHistory: boolean
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 1000,
  rightClickPaste: true,
  copyOnSelect: true,
  theme: "default",
  opacity: 95,
  backgroundImage: "",
  backgroundImageOpacity: 20,
  backgroundImageOverlayOpacity: 78,
  maxTabs: 50,
  inactiveMinutes: 60,
  hibernateBackground: true,
  autoReconnect: true,
  confirmBeforeClose: true,
  monitorInterval: 2,
  copyShortcut: "Ctrl+Shift+C",
  pasteShortcut: "Ctrl+Shift+V",
  clearShortcut: "Ctrl+L",
  completionEnabled: true,
  completionTrigger: "auto",
  completionAutoDelay: 300,
  completionMaxItems: 10,
  completionShowIcon: true,
  completionShowDescription: true,
  completionProviders: {
    local: true,
    remoteHistory: true,
    script: true,
    session: true,
  },
  completionQuotas: {
    localMin: 1,
    localMax: 3,
    scriptMin: 0,
    scriptMax: 2,
    sessionMin: 0,
    sessionMax: 2,
    remoteHistoryUnlimited: true,
    remoteHistorySoftMax: 7,
  },
  completionCache: {
    ttlMinutes: 5,
    maxEntries: 100,
  },
}

export function resolveTerminalBackgroundImageLayerOpacity(
  imageOpacityPercent: number,
  overlayOpacityPercent: number,
): number {
  const targetImageOpacity = Math.min(100, Math.max(0, imageOpacityPercent)) / 100
  const overlayOpacity = Math.min(95, Math.max(60, overlayOpacityPercent)) / 100
  const remainingVisibility = Math.max(0.05, 1 - overlayOpacity)

  return Math.min(1, targetImageOpacity / remainingVisibility)
}

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, numericValue))
}

const normalizeChoice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback)

const normalizeBoolean = (value: unknown, fallback: boolean) => (
  typeof value === "boolean" ? value : fallback
)

const normalizeString = (value: unknown, fallback: string) => (
  typeof value === "string" ? value : fallback
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === "object" && !Array.isArray(value)
)

export function normalizeTerminalSettings(input: unknown): TerminalSettings {
  const value = input && typeof input === "object"
    ? input as Partial<TerminalSettings>
    : {}
  const defaults = DEFAULT_TERMINAL_SETTINGS
  const providers = (value.completionProviders ?? {}) as Partial<TerminalCompletionProviders>
  const quotas = (value.completionQuotas ?? {}) as Partial<TerminalCompletionQuotas>
  const cache = (value.completionCache ?? {}) as Partial<TerminalCompletionCache>

  return {
    fontSize: clampNumber(value.fontSize, defaults.fontSize, 8, 24),
    fontFamily: normalizeString(value.fontFamily, defaults.fontFamily),
    cursorStyle: normalizeChoice(value.cursorStyle, ["block", "underline", "bar"] as const, defaults.cursorStyle),
    cursorBlink: normalizeBoolean(value.cursorBlink, defaults.cursorBlink),
    scrollback: clampNumber(value.scrollback, defaults.scrollback, 100, 10000),
    rightClickPaste: normalizeBoolean(value.rightClickPaste, defaults.rightClickPaste),
    copyOnSelect: normalizeBoolean(value.copyOnSelect, defaults.copyOnSelect),
    theme: normalizeChoice(value.theme, ["default", "dark", "light", "solarized", "dracula"] as const, defaults.theme),
    opacity: clampNumber(value.opacity, defaults.opacity, 50, 100),
    backgroundImage: normalizeString(value.backgroundImage, defaults.backgroundImage),
    backgroundImageOpacity: clampNumber(
      value.backgroundImageOpacity,
      defaults.backgroundImageOpacity,
      0,
      100,
    ),
    backgroundImageOverlayOpacity: clampNumber(
      value.backgroundImageOverlayOpacity,
      defaults.backgroundImageOverlayOpacity,
      60,
      95,
    ),
    maxTabs: clampNumber(value.maxTabs, defaults.maxTabs, 5, 100),
    inactiveMinutes: clampNumber(value.inactiveMinutes, defaults.inactiveMinutes, 10, 180),
    hibernateBackground: normalizeBoolean(value.hibernateBackground, defaults.hibernateBackground),
    autoReconnect: normalizeBoolean(value.autoReconnect, defaults.autoReconnect),
    confirmBeforeClose: normalizeBoolean(value.confirmBeforeClose, defaults.confirmBeforeClose),
    monitorInterval: clampNumber(value.monitorInterval, defaults.monitorInterval, 1, 10),
    copyShortcut: normalizeString(value.copyShortcut, defaults.copyShortcut),
    pasteShortcut: normalizeString(value.pasteShortcut, defaults.pasteShortcut),
    clearShortcut: normalizeString(value.clearShortcut, defaults.clearShortcut),
    completionEnabled: normalizeBoolean(value.completionEnabled, defaults.completionEnabled),
    completionTrigger: normalizeChoice(value.completionTrigger, ["tab", "auto"] as const, defaults.completionTrigger),
    completionAutoDelay: clampNumber(value.completionAutoDelay, defaults.completionAutoDelay, 100, 1000),
    completionMaxItems: clampNumber(value.completionMaxItems, defaults.completionMaxItems, 5, 20),
    completionShowIcon: normalizeBoolean(value.completionShowIcon, defaults.completionShowIcon),
    completionShowDescription: normalizeBoolean(
      value.completionShowDescription,
      defaults.completionShowDescription,
    ),
    completionProviders: {
      local: normalizeBoolean(providers.local, defaults.completionProviders.local),
      remoteHistory: normalizeBoolean(
        providers.remoteHistory,
        defaults.completionProviders.remoteHistory,
      ),
      script: normalizeBoolean(providers.script, defaults.completionProviders.script),
      session: normalizeBoolean(providers.session, defaults.completionProviders.session),
    },
    completionQuotas: {
      localMin: clampNumber(quotas.localMin, defaults.completionQuotas.localMin, 0, 10),
      localMax: clampNumber(quotas.localMax, defaults.completionQuotas.localMax, 1, 10),
      scriptMin: clampNumber(quotas.scriptMin, defaults.completionQuotas.scriptMin, 0, 10),
      scriptMax: clampNumber(quotas.scriptMax, defaults.completionQuotas.scriptMax, 0, 10),
      sessionMin: clampNumber(quotas.sessionMin, defaults.completionQuotas.sessionMin, 0, 10),
      sessionMax: clampNumber(quotas.sessionMax, defaults.completionQuotas.sessionMax, 0, 10),
      remoteHistoryUnlimited: normalizeBoolean(
        quotas.remoteHistoryUnlimited,
        defaults.completionQuotas.remoteHistoryUnlimited,
      ),
      remoteHistorySoftMax: clampNumber(
        quotas.remoteHistorySoftMax,
        defaults.completionQuotas.remoteHistorySoftMax,
        1,
        20,
      ),
    },
    completionCache: {
      ttlMinutes: clampNumber(cache.ttlMinutes, defaults.completionCache.ttlMinutes, 1, 60),
      maxEntries: clampNumber(cache.maxEntries, defaults.completionCache.maxEntries, 10, 1000),
    },
  }
}

export function loadTerminalSettingsFromStorage(storage: Storage): TerminalSettings {
  const saved = storage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)
  if (!saved) {
    return DEFAULT_TERMINAL_SETTINGS
  }

  return normalizeTerminalSettings(JSON.parse(saved))
}

export function createTerminalSettingsExportPayload(
  settings: TerminalSettings,
): TerminalSettingsExportPayload {
  return {
    schema: TERMINAL_SETTINGS_EXPORT_SCHEMA,
    version: TERMINAL_SETTINGS_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    settings: normalizeTerminalSettings(settings),
  }
}

export function serializeTerminalSettingsExport(settings: TerminalSettings): string {
  return `${JSON.stringify(createTerminalSettingsExportPayload(settings), null, 2)}\n`
}

export function parseTerminalSettingsImport(content: string): TerminalSettings {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error("invalid_json")
  }

  if (
    !isRecord(parsed) ||
    parsed.schema !== TERMINAL_SETTINGS_EXPORT_SCHEMA ||
    parsed.version !== TERMINAL_SETTINGS_EXPORT_VERSION ||
    !isRecord(parsed.settings)
  ) {
    throw new Error("invalid_terminal_settings")
  }

  return normalizeTerminalSettings(parsed.settings)
}

export function buildTerminalCompletionProviderFlags(
  settings: TerminalSettings,
): TerminalCompletionProviderFlags {
  return {
    local: settings.completionProviders.local,
    session: settings.completionProviders.session,
    script: settings.completionProviders.script,
    remoteHistory: settings.completionProviders.remoteHistory,
  }
}

export function buildTerminalCompletionSourceQuotas(settings: TerminalSettings): SourceQuotaConfig[] {
  const quotas = settings.completionQuotas
  const sourceQuotas: SourceQuotaConfig[] = []

  if (settings.completionProviders.local) {
    sourceQuotas.push({
      providerName: "local",
      min: Math.min(quotas.localMin, quotas.localMax),
      max: quotas.localMax,
    })
  }

  if (settings.completionProviders.script) {
    sourceQuotas.push({
      providerName: "script",
      min: Math.min(quotas.scriptMin, quotas.scriptMax),
      max: quotas.scriptMax,
    })
  }

  if (settings.completionProviders.session) {
    sourceQuotas.push({
      providerName: "session",
      min: Math.min(quotas.sessionMin, quotas.sessionMax),
      max: quotas.sessionMax,
    })
  }

  if (settings.completionProviders.remoteHistory) {
    sourceQuotas.push({
      providerName: "remote-history",
      min: 0,
      max: quotas.remoteHistoryUnlimited ? Infinity : quotas.remoteHistorySoftMax,
      unlimited: quotas.remoteHistoryUnlimited,
      softMax: quotas.remoteHistorySoftMax,
    })
  }

  return sourceQuotas
}

export function buildTerminalCompletionConfig(settings: TerminalSettings): CompletionConfig {
  return {
    ...DEFAULT_COMPLETION_CONFIG,
    enabled: settings.completionEnabled,
    trigger: settings.completionTrigger,
    autoTriggerDelay: settings.completionAutoDelay,
    maxItems: settings.completionMaxItems,
    providers: {
      local: settings.completionProviders.local,
      remote: settings.completionProviders.remoteHistory,
      history: settings.completionProviders.session,
      script: settings.completionProviders.script,
      session: settings.completionProviders.session,
    },
    showDescription: settings.completionShowDescription,
    showIcon: settings.completionShowIcon,
    enableQuotaAllocation: true,
    sourceQuotas: buildTerminalCompletionSourceQuotas(settings),
    cache: {
      ttl_minutes: settings.completionCache.ttlMinutes,
      max_entries: settings.completionCache.maxEntries,
    },
  }
}

export function buildTerminalCompletionFetchOptions(settings: TerminalSettings): CompletionFetchOptions {
  const includeHistory = settings.completionEnabled && settings.completionProviders.remoteHistory
  const includeScripts = settings.completionEnabled && settings.completionProviders.script

  return {
    historyLimit: includeHistory && settings.completionQuotas.remoteHistoryUnlimited
      ? 500
      : includeHistory
        ? settings.completionQuotas.remoteHistorySoftMax
        : 0,
    includeHistory,
    includeScripts,
    cacheTtlMinutes: settings.completionCache.ttlMinutes,
    cacheMaxEntries: settings.completionCache.maxEntries,
  }
}
