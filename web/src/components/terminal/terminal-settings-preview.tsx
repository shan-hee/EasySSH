import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Terminal, ITerminalOptions } from "@xterm/xterm"
import type { FitAddon } from "@xterm/addon-fit"
import { useEffectiveThemeMode } from "@/hooks/use-effective-theme-mode"
import { resolveTerminalBoldFontWeight, type TerminalSettings } from "./terminal-settings"
import {
  formatTerminalFontFamily,
  resolveTerminalRendererTheme,
  useTerminalRendererSettings,
} from "./use-terminal-renderer-settings"

const SAMPLE_OUTPUT = [
  "\x1b[32muser@easyssh\x1b[0m:\x1b[34m~\x1b[0m$ ls",
  "\x1b[1;34mDocuments/\x1b[0m  deploy.log  项目说明.md",
  "\x1b[32muser@easyssh\x1b[0m:\x1b[34m~\x1b[0m$ cat deploy.log",
  "\x1b[32m[OK]\x1b[0m \x1b[1mService started\x1b[0m · 服务已启动",
  "\x1b[33m[WARN]\x1b[0m Disk usage: \x1b[36m82%\x1b[0m",
  "\x1b[32muser@easyssh\x1b[0m:\x1b[34m~\x1b[0m$ ",
].join("\r\n")

export function TerminalSettingsPreview({ settings }: { settings: TerminalSettings }) {
  const { t } = useTranslation("terminalSettings")
  const { mode, version } = useEffectiveThemeMode()
  const containerRef = useRef<HTMLDivElement>(null)
  const [instance, setInstance] = useState<{ terminal: Terminal; fit: FitAddon } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [failedBackground, setFailedBackground] = useState<string | null>(null)
  const transparentBackground = !!settings.backgroundImage
  const { terminalTheme, terminalRendererTheme } = useMemo(() => {
    void version
    return resolveTerminalRendererTheme({
      theme: settings.theme,
      appTheme: mode,
      transparentBackground,
    })
  }, [settings.theme, mode, version, transparentBackground])
  const fontFamily = formatTerminalFontFamily(settings.fontFamily)
  // Capture startup options once; the shared renderer hook applies subsequent edits.
  const [initialOptions] = useState<ITerminalOptions>(() => ({
    theme: terminalRendererTheme,
    allowTransparency: transparentBackground,
    fontFamily,
    fontSize: settings.fontSize,
    fontWeight: settings.fontWeight,
    fontWeightBold: resolveTerminalBoldFontWeight(settings.fontWeight),
    lineHeight: settings.lineHeight,
    letterSpacing: 0,
    cursorStyle: settings.cursorStyle,
    cursorInactiveStyle: settings.cursorStyle,
    cursorWidth: settings.cursorStyle === "bar" ? 2 : 1,
    cursorBlink: settings.cursorBlink,
    disableStdin: true,
    scrollback: 100,
    cols: 80,
    rows: 6,
    allowProposedApi: true,
  }))

  useTerminalRendererSettings({
    terminal: instance?.terminal,
    fitAddon: instance?.fit,
    terminalReady: !!instance,
    terminalRendererTheme,
    allowTransparency: transparentBackground,
    themeModeVersion: version,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    fontFamily,
    fontWeight: settings.fontWeight,
    fontWeightBold: resolveTerminalBoldFontWeight(settings.fontWeight),
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    scrollback: 100,
  })

  useLayoutEffect(() => {
    if (instance) instance.terminal.options.cursorInactiveStyle = settings.cursorStyle
  }, [instance, settings.cursorStyle])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let terminal: Terminal | undefined
    let observer: ResizeObserver | undefined
    let frame = 0

    async function initialize() {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/xterm/css/xterm.css"),
        ])
        if (cancelled) return
        const preview = new Terminal(initialOptions)
        terminal = preview
        const fit = new FitAddon()
        preview.loadAddon(fit)
        preview.open(container!)
        fit.fit()
        preview.write(SAMPLE_OUTPUT + "\x1b[?25h")
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => {
            fit.fit()
          })
        })
        observer.observe(container!)
        setInstance({ terminal: preview, fit })

        // Keep the preview on xterm's DOM renderer. WebGL terminals with matching
        // options share an atlas; preview refreshes must not clear live glyphs.
      } catch {
        if (!cancelled) {
          observer?.disconnect()
          cancelAnimationFrame(frame)
          terminal?.dispose()
          terminal = undefined
          setInstance(null)
          setLoadFailed(true)
        }
      }
    }

    void initialize()
    return () => {
      cancelled = true
      observer?.disconnect()
      cancelAnimationFrame(frame)
      terminal?.dispose()
    }
  }, [initialOptions])

  useEffect(() => {
    instance?.terminal.textarea?.setAttribute("aria-label", t("previewLabel"))
  }, [instance, t])

  return (
    <div className="space-y-2">
      <div
        className="relative h-[160px] overflow-hidden rounded-lg border p-3 sm:p-4"
        style={{ backgroundColor: terminalTheme.background }}
      >
        {transparentBackground && (
          <img
            key={settings.backgroundImage}
            alt=""
            src={settings.backgroundImage}
            onLoad={() => setFailedBackground(null)}
            onError={() => setFailedBackground(settings.backgroundImage)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            style={{ opacity: settings.backgroundImageOpacity / 100 }}
          />
        )}
        <div
          ref={containerRef}
          className="relative h-full w-full min-w-0 [&_.xterm-viewport]:overscroll-contain [&_.xterm-viewport]:[scrollbar-width:thin]"
        />
        {(!instance || loadFailed) && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: terminalTheme.foreground }}
          >
            {t(loadFailed ? "previewLoadFailed" : "previewLoading")}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("previewHelp")}</p>
      {settings.backgroundImage && failedBackground === settings.backgroundImage && (
        <p role="alert" className="text-sm text-destructive">
          {t("backgroundInvalid")}
        </p>
      )}
    </div>
  )
}
