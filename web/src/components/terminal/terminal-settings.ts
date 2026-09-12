import { normalizeShortcut, TERMINAL_SHORTCUT_KEYS } from "./terminal-shortcuts"
import type { CompletionConfig } from "@/lib/completion/types"
import { DEFAULT_COMPLETION_CONFIG } from "@/lib/completion/types"
import type { CompletionFetchOptions } from "@/lib/websocket-terminal"

export const TERMINAL_SETTINGS_STORAGE_KEY = "terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_SCHEMA = "easyssh.terminal-settings"
export const TERMINAL_SETTINGS_EXPORT_VERSION = 3

export const TERMINAL_MONITOR_INTERVAL_SECONDS = 2
export const TERMINAL_BACKGROUND_TINT_OPACITY = 0.55
export const TERMINAL_FONT_FAMILIES = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
  "monospace",
] as const
export const MAX_TERMINAL_BACKGROUND_BYTES = 2 * 1024 * 1024

export function isTerminalBackgroundImage(value: unknown): boolean {
  if (typeof value !== "string") return false
  if (!value) return true
  if (value.length > MAX_TERMINAL_BACKGROUND_BYTES * 1.4) return false
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true
  try {
    const url = new URL(value)
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
  } catch {
    return false
  }
}

const normalizeNumberChoice = (value: unknown, choices: number[], fallback: number) =>
  typeof value === "number" && choices.includes(value) ? value : fallback

export type TerminalCompletionMode = "auto" | "tab" | "off"

export interface TerminalSettings {
  // 终端设置
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: "block" | "underline" | "bar"
  cursorBlink: boolean
  scrollback: number
  rightClickPaste: boolean
  copyOnSelect: boolean
  multiLinePasteWarning: boolean

  // 主题设置
  theme: "default" | "dark" | "light" | "solarized" | "dracula"
  backgroundImage: string
  backgroundImageOpacity: number

  // 行为设置
  inactiveMinutes: number
  autoReconnect: boolean

  // 快捷键设置
  copyShortcut: string
  pasteShortcut: string
  clearShortcut: string
  findShortcut: string
  zoomInShortcut: string
  zoomOutShortcut: string
  zoomResetShortcut: string

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

type TerminalCompletionSettings = Pick<
  TerminalSettings,
  "completionMode" | "completionUseHistory" | "completionUseScripts" | "completionUseRemotePaths"
>

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
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 5000,
  rightClickPaste: true,
  copyOnSelect: true,
  multiLinePasteWarning: true,
  theme: "default",
  backgroundImage: "",
  backgroundImageOpacity: 100,
  inactiveMinutes: 60,
  autoReconnect: true,
  copyShortcut: "Ctrl+Shift+C",
  pasteShortcut: "Ctrl+Shift+V",
  clearShortcut: "Ctrl+Shift+K",
  findShortcut: "Ctrl+Shift+F",
  zoomInShortcut: "Ctrl+Shift+Plus",
  zoomOutShortcut: "Ctrl+-",
  zoomResetShortcut: "Ctrl+0",
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

const normalizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export function normalizeTerminalSettings(input: unknown): TerminalSettings {
  const value = input && typeof input === "object" ? (input as Partial<TerminalSettings>) : {}
  const defaults = DEFAULT_TERMINAL_SETTINGS
  const shortcuts = {} as Pick<TerminalSettings, (typeof TERMINAL_SHORTCUT_KEYS)[number]>
  const usedShortcuts = new Set<string>()
  for (const key of TERMINAL_SHORTCUT_KEYS) {
    const candidate = value[key]
    const shortcut =
      (typeof candidate === "string" ? normalizeShortcut(candidate) : null) ?? defaults[key]
    shortcuts[key] = usedShortcuts.has(shortcut) ? "" : shortcut
    if (shortcuts[key]) usedShortcuts.add(shortcuts[key])
  }
  return {
    ...shortcuts,
    fontSize: Math.round(clampNumber(value.fontSize, defaults.fontSize, 8, 40)),
    fontFamily: normalizeChoice(value.fontFamily, TERMINAL_FONT_FAMILIES, defaults.fontFamily),
    lineHeight: normalizeNumberChoice(value.lineHeight, [1, 1.2, 1.4], defaults.lineHeight),
    cursorStyle: normalizeChoice(
      value.cursorStyle,
      ["block", "underline", "bar"] as const,
      defaults.cursorStyle,
    ),
    cursorBlink: normalizeBoolean(value.cursorBlink, defaults.cursorBlink),
    scrollback: normalizeNumberChoice(value.scrollback, [1000, 5000, 10000], defaults.scrollback),
    rightClickPaste: normalizeBoolean(value.rightClickPaste, defaults.rightClickPaste),
    copyOnSelect: normalizeBoolean(value.copyOnSelect, defaults.copyOnSelect),
    multiLinePasteWarning: normalizeBoolean(
      value.multiLinePasteWarning,
      defaults.multiLinePasteWarning,
    ),
    theme: normalizeChoice(
      value.theme,
      ["default", "dark", "light", "solarized", "dracula"] as const,
      defaults.theme,
    ),
    backgroundImage: isTerminalBackgroundImage(value.backgroundImage)
      ? (value.backgroundImage as string)
      : defaults.backgroundImage,
    backgroundImageOpacity:
      Math.round(
        clampNumber(value.backgroundImageOpacity, defaults.backgroundImageOpacity, 0, 100) / 5,
      ) * 5,
    inactiveMinutes:
      value.inactiveMinutes === 0
        ? 0
        : Math.round(clampNumber(value.inactiveMinutes, defaults.inactiveMinutes, 5, 1440)),
    autoReconnect: normalizeBoolean(value.autoReconnect, defaults.autoReconnect),
    completionMode: normalizeChoice(
      value.completionMode,
      ["auto", "tab", "off"] as const,
      defaults.completionMode,
    ),
    completionUseHistory: normalizeBoolean(
      value.completionUseHistory,
      defaults.completionUseHistory,
    ),
    completionUseScripts: normalizeBoolean(
      value.completionUseScripts,
      defaults.completionUseScripts,
    ),
    completionUseRemotePaths: normalizeBoolean(
      value.completionUseRemotePaths,
      defaults.completionUseRemotePaths,
    ),
  }
}

export function resolveTerminalInactiveMinutes(minutes: number, limit = 1440): number {
  return minutes === 0 ? 0 : Math.min(minutes, limit)
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

  const imported = parsed.settings
  const normalized = normalizeTerminalSettings(imported)
  const keys = Object.keys(normalized) as (keyof TerminalSettings)[]
  if (
    Object.keys(imported).length !== keys.length ||
    keys.some((key) => imported[key] !== normalized[key])
  ) {
    throw new Error("invalid_terminal_settings_values")
  }
  return normalized
}

export function buildTerminalCompletionProviderFlags(
  settings: TerminalCompletionSettings,
): TerminalCompletionProviderFlags {
  return {
    local: true,
    session: settings.completionUseHistory,
    script: settings.completionUseScripts,
    remoteHistory: settings.completionUseHistory,
    path: settings.completionUseRemotePaths,
  }
}

export function buildTerminalCompletionConfig(
  settings: TerminalCompletionSettings,
): CompletionConfig {
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

export function buildTerminalCompletionFetchOptions(
  settings: TerminalCompletionSettings,
): CompletionFetchOptions {
  const enabled = settings.completionMode !== "off"

  return {
    includeHistory: enabled && settings.completionUseHistory,
    includeScripts: enabled && settings.completionUseScripts,
  }
}
