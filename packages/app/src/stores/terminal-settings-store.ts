import { create } from "zustand"
import {
  DEFAULT_TERMINAL_SETTINGS,
  loadTerminalSettingsFromStorage,
  normalizeTerminalSettings,
  TERMINAL_SETTINGS_STORAGE_KEY,
  type TerminalSettings,
} from "@/components/terminal/terminal-settings"

function readSettings(): TerminalSettings {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_SETTINGS
  try {
    return loadTerminalSettingsFromStorage(window.localStorage)
  } catch {
    return DEFAULT_TERMINAL_SETTINGS
  }
}

// Device preferences shared by every terminal workspace; only saved values become effective.
export const useTerminalSettingsStore = create<{
  settings: TerminalSettings
  saveSettings: (settings: TerminalSettings) => void
}>((set) => ({
  settings: readSettings(),
  saveSettings: (settings) => {
    const normalized = normalizeTerminalSettings(settings)
    window.localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
    set({ settings: normalized })
  },
}))

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (
      event.storageArea === window.localStorage &&
      (event.key === TERMINAL_SETTINGS_STORAGE_KEY || event.key === null)
    ) {
      useTerminalSettingsStore.setState({ settings: readSettings() })
    }
  })
}
