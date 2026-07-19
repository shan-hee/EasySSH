import type { CompletionConfig } from "@/lib/completion/types"
import { DEFAULT_COMPLETION_CONFIG } from "@/lib/completion/types"
import type { CompletionFetchOptions } from "@/lib/websocket-terminal"

export const TERMINAL_SETTINGS_STORAGE_KEY = "terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_SCHEMA = "easyssh.terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_VERSION = 2

export type TerminalCompletionMode = "auto" | "tab" | "off"

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
  backgroundImage: string
  backgroundImageOpacity: number
  backgroundTextEnhance: boolean

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
  completionMode: TerminalCompletionMode
  completionUseHistory: boolean
  completionUseScripts: boolean
  completionUseRemotePaths: boolean
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
  path: boolean
}

const TERMINAL_COMPLETION_POLICY = {
  autoDelayMs: 200,
  maxItems: 10,
  showIcon: true,
  showDescription: true,
} as const

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 1000,
  rightClickPaste: true,
  copyOnSelect: true,
  theme: "default",
  backgroundImage: "",
  backgroundImageOpacity: 100,
  backgroundTextEnhance: true,
  maxTabs: 50,
  inactiveMinutes: 60,
  hibernateBackground: true,
  autoReconnect: true,
  confirmBeforeClose: true,
  monitorInterval: 2,
  copyShortcut: "Ctrl+Shift+C",
  pasteShortcut: "Ctrl+Shift+V",
  clearShortcut: "Ctrl+L",
  completionMode: "auto",
  completionUseHistory: true,
  completionUseScripts: true,
  completionUseRemotePaths: true,
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
  return {
    fontSize: clampNumber(value.fontSize, defaults.fontSize, 8, 24),
    fontFamily: normalizeString(value.fontFamily, defaults.fontFamily),
    cursorStyle: normalizeChoice(value.cursorStyle, ["block", "underline", "bar"] as const, defaults.cursorStyle),
    cursorBlink: normalizeBoolean(value.cursorBlink, defaults.cursorBlink),
    scrollback: clampNumber(value.scrollback, defaults.scrollback, 100, 10000),
    rightClickPaste: normalizeBoolean(value.rightClickPaste, defaults.rightClickPaste),
    copyOnSelect: normalizeBoolean(value.copyOnSelect, defaults.copyOnSelect),
    theme: normalizeChoice(value.theme, ["default", "dark", "light", "solarized", "dracula"] as const, defaults.theme),
    backgroundImage: normalizeString(value.backgroundImage, defaults.backgroundImage),
    backgroundImageOpacity: clampNumber(
      value.backgroundImageOpacity,
      defaults.backgroundImageOpacity,
      0,
      100,
    ),
    backgroundTextEnhance: normalizeBoolean(
      value.backgroundTextEnhance,
      defaults.backgroundTextEnhance,
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
    completionMode: normalizeChoice(
      value.completionMode,
      ["auto", "tab", "off"] as const,
      defaults.completionMode,
    ),
    completionUseHistory: normalizeBoolean(value.completionUseHistory, defaults.completionUseHistory),
    completionUseScripts: normalizeBoolean(value.completionUseScripts, defaults.completionUseScripts),
    completionUseRemotePaths: normalizeBoolean(
      value.completionUseRemotePaths,
      defaults.completionUseRemotePaths,
    ),
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
    local: true,
    session: settings.completionUseHistory,
    script: settings.completionUseScripts,
    remoteHistory: settings.completionUseHistory,
    path: settings.completionUseRemotePaths,
  }
}

export function buildTerminalCompletionConfig(settings: TerminalSettings): CompletionConfig {
  const enabled = settings.completionMode !== "off"
  return {
    ...DEFAULT_COMPLETION_CONFIG,
    enabled,
    trigger: settings.completionMode === "tab" ? "tab" : "auto",
    autoTriggerDelay: TERMINAL_COMPLETION_POLICY.autoDelayMs,
    maxItems: TERMINAL_COMPLETION_POLICY.maxItems,
    providers: {
      local: true,
      remote: settings.completionUseHistory,
      history: settings.completionUseHistory,
      script: settings.completionUseScripts,
      session: settings.completionUseHistory,
      path: settings.completionUseRemotePaths,
    },
    showDescription: TERMINAL_COMPLETION_POLICY.showDescription,
    showIcon: TERMINAL_COMPLETION_POLICY.showIcon,
    enableQuotaAllocation: true,
  }
}

export function buildTerminalCompletionFetchOptions(settings: TerminalSettings): CompletionFetchOptions {
  const enabled = settings.completionMode !== "off"

  return {
    includeHistory: enabled && settings.completionUseHistory,
    includeScripts: enabled && settings.completionUseScripts,
  }
}
