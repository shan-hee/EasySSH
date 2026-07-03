
import { useEffect, useLayoutEffect } from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"
import {
  getTerminalTheme,
  withTerminalBackgroundOpacity,
  type TerminalTheme,
} from "./terminal-themes"

export type TerminalThemeName = "default" | "dark" | "light" | "solarized" | "dracula"
export type TerminalCursorStyle = "block" | "underline" | "bar"
export type TerminalAppThemeMode = "light" | "dark"
export type TerminalFontWeight = "normal" | "bold" | "400" | "500" | "600" | "700"

export interface TerminalRendererThemeResult {
  terminalTheme: TerminalTheme
  terminalRendererTheme: TerminalTheme
}

export interface ResolveTerminalRendererThemeOptions {
  theme: TerminalThemeName
  appTheme: TerminalAppThemeMode
  transparentBackground: boolean
}

export type TerminalThemeModePreference = TerminalAppThemeMode | "system"

export interface UseTerminalRendererSettingsOptions {
  terminal: Terminal | null | undefined
  fitAddon?: FitAddon | null
  terminalReady: boolean
  terminalRendererTheme: TerminalTheme
  allowTransparency: boolean
  themeModeVersion: number
  fontSize: number
  fontFamily: string
  fontWeight: TerminalFontWeight
  fontWeightBold: TerminalFontWeight
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  scrollback: number
}

export function formatTerminalFontFamily(fontFamily: string) {
  const terminalFallback = `"JetBrains Mono", "JetBrains Mono Variable", "Fira Code", "Fira Code Variable", Monaco, Menlo, "Ubuntu Mono", monospace`
  const loadedFontFamilyNames: Record<string, string> = {
    "Cascadia Code": `"Cascadia Code", "Cascadia Code Variable"`,
    "Fira Code": `"Fira Code", "Fira Code Variable"`,
    "JetBrains Mono": `"JetBrains Mono", "JetBrains Mono Variable"`,
    "Source Code Pro": `"Source Code Pro", "Source Code Pro Variable"`,
  }

  const loadedFontFamilyName = loadedFontFamilyNames[fontFamily]
  if (loadedFontFamilyName) {
    return `${loadedFontFamilyName}, ${terminalFallback}`
  }

  if (fontFamily === "monospace") {
    return `monospace, ${terminalFallback}`
  }

  return `"${fontFamily.replace(/"/g, '\\"')}", ${terminalFallback}`
}

function scheduleTerminalRefresh(
  terminal: Terminal,
  fitAddon: FitAddon | null | undefined,
  shouldFit = false,
) {
  requestAnimationFrame(() => {
    if (shouldFit) {
      terminal.clearTextureAtlas()
      fitAddon?.fit()
    }
    terminal.refresh(0, Math.max(terminal.rows - 1, 0))
  })
}

async function loadTerminalFontFamily(
  fontFamily: string,
  fontSize: number,
  fontWeight: TerminalFontWeight,
  fontWeightBold: TerminalFontWeight,
) {
  if (typeof document === "undefined" || !document.fonts?.load) return

  const fontFamilyStack = fontFamily.trim()
  if (!fontFamilyStack) return

  try {
    await Promise.all([
      document.fonts.load(`${fontWeight} ${fontSize}px ${fontFamilyStack}`),
      document.fonts.load(`${fontWeightBold} ${fontSize}px ${fontFamilyStack}`),
      document.fonts.ready,
    ])
  } catch {
    await document.fonts.ready
  }
}

export function resolveTerminalThemeName(
  theme: TerminalThemeName | string | null | undefined,
  fallback: TerminalThemeName = "default",
): TerminalThemeName {
  switch (theme) {
    case "default":
    case "dark":
    case "light":
    case "solarized":
    case "dracula":
      return theme
    default:
      return fallback
  }
}

export function resolveTerminalAppThemeMode(
  mode: TerminalThemeModePreference | string | null | undefined,
  fallback: TerminalAppThemeMode,
): TerminalAppThemeMode {
  if (mode === "light" || mode === "dark") {
    return mode
  }

  return fallback
}

export function resolveTerminalRendererTheme({
  theme,
  appTheme,
  transparentBackground,
}: ResolveTerminalRendererThemeOptions): TerminalRendererThemeResult {
  const terminalTheme = getTerminalTheme(theme, appTheme)
  const transparentTerminalBackground = withTerminalBackgroundOpacity(terminalTheme.background, 0)
  const terminalRendererBackground = transparentBackground
    ? transparentTerminalBackground
    : terminalTheme.background

  return {
    terminalTheme,
    terminalRendererTheme: {
      ...terminalTheme,
      background: terminalRendererBackground,
    },
  }
}

export function useTerminalRendererSettings({
  terminal,
  fitAddon,
  terminalReady,
  terminalRendererTheme,
  allowTransparency,
  themeModeVersion,
  fontSize,
  fontFamily,
  fontWeight,
  fontWeightBold,
  cursorStyle,
  cursorBlink,
  scrollback,
}: UseTerminalRendererSettingsOptions) {
  useLayoutEffect(() => {
    if (!terminal) return

    terminal.options.allowTransparency = allowTransparency
    terminal.options.theme = terminalRendererTheme

    scheduleTerminalRefresh(terminal, fitAddon)
  }, [allowTransparency, fitAddon, terminal, terminalRendererTheme, themeModeVersion])

  useLayoutEffect(() => {
    if (!terminal || !terminalReady) return

    let shouldRefresh = false

    let shouldFit = false

    if (terminal.options.fontSize !== fontSize) {
      terminal.options.fontSize = fontSize
      shouldRefresh = true
      shouldFit = true
    }

    if (terminal.options.fontFamily !== fontFamily) {
      terminal.options.fontFamily = fontFamily
      shouldRefresh = true
      shouldFit = true
    }

    if (terminal.options.fontWeight !== fontWeight) {
      terminal.options.fontWeight = fontWeight
      shouldRefresh = true
      shouldFit = true
    }

    if (terminal.options.fontWeightBold !== fontWeightBold) {
      terminal.options.fontWeightBold = fontWeightBold
      shouldRefresh = true
      shouldFit = true
    }

    if (terminal.options.cursorStyle !== cursorStyle) {
      terminal.options.cursorStyle = cursorStyle
      terminal.options.cursorWidth = cursorStyle === "bar" ? 2 : 1
      shouldRefresh = true
    }

    if (terminal.options.cursorBlink !== cursorBlink) {
      terminal.options.cursorBlink = cursorBlink
      shouldRefresh = true
    }

    if (terminal.options.scrollback !== scrollback) {
      terminal.options.scrollback = scrollback
      shouldRefresh = true
    }

    if (shouldRefresh) {
      scheduleTerminalRefresh(terminal, fitAddon, shouldFit)
    }
  }, [
    cursorBlink,
    cursorStyle,
    fitAddon,
    fontFamily,
    fontSize,
    fontWeight,
    fontWeightBold,
    scrollback,
    terminal,
    terminalReady,
  ])

  useEffect(() => {
    if (!terminal || !terminalReady) return

    let cancelled = false

    void loadTerminalFontFamily(fontFamily, fontSize, fontWeight, fontWeightBold).then(() => {
      if (
        cancelled ||
        terminal.options.fontFamily !== fontFamily ||
        terminal.options.fontSize !== fontSize ||
        terminal.options.fontWeight !== fontWeight ||
        terminal.options.fontWeightBold !== fontWeightBold
      ) {
        return
      }

      scheduleTerminalRefresh(terminal, fitAddon, true)
    })

    return () => {
      cancelled = true
    }
  }, [fitAddon, fontFamily, fontSize, fontWeight, fontWeightBold, terminal, terminalReady])

  useEffect(() => {
    if (!terminal || !terminalReady) return

    if (terminal.options.scrollSensitivity !== 1) {
      terminal.options.scrollSensitivity = 1
    }
    if (terminal.options.fastScrollSensitivity !== 2) {
      terminal.options.fastScrollSensitivity = 2
    }
    if (terminal.options.fastScrollModifier !== "shift") {
      terminal.options.fastScrollModifier = "shift"
    }
  }, [terminalReady, terminal])
}
