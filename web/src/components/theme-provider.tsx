
import * as React from "react"

type ThemePreference = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

const windowOpacityStorageKey = "easyssh-window-opacity"
export const minimumWindowOpacity = 50
export const maximumWindowOpacity = 100

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: ThemePreference
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}

interface ThemeContextValue {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  windowOpacity: number
  setTheme: (theme: ThemePreference) => void
  setWindowOpacity: (opacity: number) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

function getStoredTheme(defaultTheme: ThemePreference): ThemePreference {
  if (typeof window === "undefined") {
    return defaultTheme
  }

  const stored = window.localStorage.getItem("theme")
  return stored === "light" || stored === "dark" || stored === "system" ? stored : defaultTheme
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function normalizeWindowOpacity(value: number) {
  if (!Number.isFinite(value)) {
    return maximumWindowOpacity
  }

  return Math.min(maximumWindowOpacity, Math.max(minimumWindowOpacity, Math.round(value)))
}

function getStoredWindowOpacity() {
  if (typeof window === "undefined") {
    return maximumWindowOpacity
  }

  const stored = window.localStorage.getItem(windowOpacityStorageKey)
  return stored === null ? maximumWindowOpacity : normalizeWindowOpacity(Number(stored))
}

function applyWindowOpacity(opacity: number) {
  document.documentElement.style.setProperty("--window-opacity", String(opacity / 100))
}

function resolveTheme(theme: ThemePreference, enableSystem: boolean): ResolvedTheme {
  if (theme === "system") {
    return enableSystem ? getSystemTheme() : "light"
  }

  return theme
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
}

function disableTransitionsTemporarily() {
  const css = document.createElement("style")
  css.appendChild(
    document.createTextNode(
      "*,*::before,*::after{transition:none!important;animation-duration:0.01ms!important;animation-delay:0s!important}",
    ),
  )
  document.head.appendChild(css)
  window.getComputedStyle(document.body)
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      css.remove()
    })
  })
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  enableSystem = true,
  disableTransitionOnChange = false,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<ThemePreference>(() => getStoredTheme(defaultTheme))
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() => resolveTheme(theme, enableSystem))
  const [windowOpacity, setWindowOpacityState] = React.useState(getStoredWindowOpacity)

  const applyResolvedTheme = React.useCallback(
    (nextResolvedTheme: ResolvedTheme) => {
      if (disableTransitionOnChange) {
        disableTransitionsTemporarily()
      }
      applyTheme(nextResolvedTheme)
    },
    [disableTransitionOnChange],
  )

  useIsomorphicLayoutEffect(() => {
    const nextResolvedTheme = resolveTheme(theme, enableSystem)
    setResolvedTheme(nextResolvedTheme)
    applyResolvedTheme(nextResolvedTheme)
    window.localStorage.setItem("theme", theme)
  }, [applyResolvedTheme, enableSystem, theme])

  useIsomorphicLayoutEffect(() => {
    applyWindowOpacity(windowOpacity)
    window.localStorage.setItem(windowOpacityStorageKey, String(windowOpacity))
  }, [windowOpacity])

  useIsomorphicLayoutEffect(() => {
    if (!enableSystem || theme !== "system") {
      return
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const nextResolvedTheme = getSystemTheme()
      setResolvedTheme(nextResolvedTheme)
      applyResolvedTheme(nextResolvedTheme)
    }

    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [applyResolvedTheme, enableSystem, theme])

  const setTheme = React.useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme)
  }, [])

  const setWindowOpacity = React.useCallback((nextOpacity: number) => {
    setWindowOpacityState(normalizeWindowOpacity(nextOpacity))
  }, [])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      windowOpacity,
      setTheme,
      setWindowOpacity,
    }),
    [resolvedTheme, setTheme, setWindowOpacity, theme, windowOpacity],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }

  return context
}
