
import * as React from "react"

type ThemePreference = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: ThemePreference
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}

interface ThemeContextValue {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

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

export function ThemeProvider({
  children,
  defaultTheme = "system",
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<ThemePreference>(() => getStoredTheme(defaultTheme))
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() => resolveTheme(theme, enableSystem))

  React.useEffect(() => {
    const nextResolvedTheme = resolveTheme(theme, enableSystem)
    setResolvedTheme(nextResolvedTheme)
    applyTheme(nextResolvedTheme)
    window.localStorage.setItem("theme", theme)
  }, [enableSystem, theme])

  React.useEffect(() => {
    if (!enableSystem || theme !== "system") {
      return
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const nextResolvedTheme = getSystemTheme()
      setResolvedTheme(nextResolvedTheme)
      applyTheme(nextResolvedTheme)
    }

    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [enableSystem, theme])

  const setTheme = React.useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme)
  }, [])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [resolvedTheme, setTheme, theme],
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
