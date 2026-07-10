
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { ConnectionLoader } from "./connection-loader"
import { TerminalAuthChallengeDialog } from "./terminal-auth-challenge-dialog"
import { TerminalHostKeyDialog } from "./terminal-host-key-dialog"
import { CompletionPopup } from "./completion-popup"
import { useTerminalAuthFlowAdapters } from "./use-terminal-auth-flow-adapters"
import { useTerminalAutoFit } from "./use-terminal-auto-fit"
import {
  useTerminalCompletionController,
  type TerminalCompletionProviderFlags,
} from "./use-terminal-completion-controller"
import { useTerminalConnectionController } from "./use-terminal-connection-controller"
import { useTerminalContainerApi, type TerminalInputApi } from "./use-terminal-container-api"
import { useTerminalInputActions } from "./use-terminal-input-actions"
import {
  formatTerminalFontFamily,
  resolveTerminalAppThemeMode,
  resolveTerminalRendererTheme,
  resolveTerminalThemeName,
  useTerminalRendererSettings,
  type TerminalCursorStyle,
  type TerminalFontWeight,
  type TerminalThemeName,
} from "./use-terminal-renderer-settings"
import type { Terminal } from "@xterm/xterm"
import { TerminalThemeProvider } from "@/contexts/terminal-theme-context"
import { useTerminalAuthFlow, type TerminalAuthFlowAdapters } from "@/components/terminal/use-terminal-auth-flow"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useTerminalInstance } from "@/hooks/useTerminalInstance"
import { useEffectiveThemeMode } from "@/hooks/use-effective-theme-mode"
import { createWorkspaceTerminalAuthTicketProviderAdapter } from "@/lib/session/workspace-adapters"
import type { CompletionConfig } from "@/lib/completion/types"
import { DEFAULT_COMPLETION_CONFIG } from "@/lib/completion/types"
import type { CompletionFetchOptions, TerminalConnectionPhase } from "@/lib/websocket-terminal"

export interface WebTerminalProps {
  sessionId: string
  serverId?: string
  serverName: string
  host: string
  username: string
  isActive: boolean
  shouldConnect: boolean
  onConnectionPhaseChange?: (phase: TerminalConnectionPhase) => void
  onAuthCancelled?: () => void
  authFlowAdapters?: TerminalAuthFlowAdapters
  onCommand: (command: string) => void
  onResize?: (cols: number, rows: number) => void
  theme?: TerminalThemeName
  fontSize?: number
  fontFamily?: string
  cursorStyle?: TerminalCursorStyle
  cursorBlink?: boolean
  scrollback?: number
  rightClickPaste?: boolean
  copyOnSelect?: boolean
  copyShortcut?: string
  pasteShortcut?: string
  clearShortcut?: string
  completionEnabled?: boolean
  completionTrigger?: "tab" | "auto"
  completionAutoDelay?: number
  completionMaxItems?: number
  completionShowIcon?: boolean
  completionShowDescription?: boolean
  completionConfig?: CompletionConfig
  completionProviderEnabled?: TerminalCompletionProviderFlags
  completionFetchOptions?: CompletionFetchOptions
  pathCompletionCwd?: string
  onInputApiChange?: (api: TerminalInputApi | null) => void
  enableWebgl?: boolean
  transparentBackground?: boolean
  fontWeight?: TerminalFontWeight
  fontWeightBold?: TerminalFontWeight
}

function parseOsc7Cwd(data: string): string | undefined {
  if (!data.startsWith("file://")) {
    return undefined
  }

  try {
    const url = new URL(data)
    const pathname = decodeURIComponent(url.pathname)
    return pathname.startsWith("/") ? pathname : undefined
  } catch {
    const match = data.match(/^file:\/\/[^/]*(\/.*)$/)
    if (!match?.[1]) {
      return undefined
    }

    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
}

export function WebTerminal({
  sessionId,
  serverId,
  serverName,
  host,
  username,
  isActive,
  shouldConnect,
  onConnectionPhaseChange,
  onAuthCancelled,
  authFlowAdapters,
  onCommand,
  onResize,
  theme = "default",
  fontSize = 14,
  fontFamily = "JetBrains Mono",
  cursorStyle = "bar",
  cursorBlink = true,
  scrollback = 1000,
  rightClickPaste = true,
  copyOnSelect = true,
  copyShortcut = "Ctrl+Shift+C",
  pasteShortcut = "Ctrl+Shift+V",
  clearShortcut = "Ctrl+L",
  completionEnabled = true,
  completionTrigger = "auto",
  completionAutoDelay = 200,
  completionMaxItems = 10,
  completionShowIcon = true,
  completionShowDescription = true,
  completionConfig,
  completionProviderEnabled,
  completionFetchOptions,
  pathCompletionCwd,
  onInputApiChange,
  enableWebgl = true,
  transparentBackground = false,
  fontWeight = "400",
  fontWeightBold = "600",
}: WebTerminalProps) {
  const { t: tTerminal } = useTranslation("terminal")
  const workspace = useOptionalSshWorkspace()
  const workspaceTerminalApi = workspace?.adapters.apiClient?.terminal
  if (workspace?.layout === "desktop" && !workspaceTerminalApi?.createWebSocketUrl) {
    throw new Error("Desktop terminal requires a desktop terminal WebSocket adapter")
  }
  const { mode: effectiveAppTheme, version: themeModeVersion } = useEffectiveThemeMode()
  const workspaceTheme = workspace?.adapters.theme
  const effectiveTerminalTheme = resolveTerminalThemeName(workspaceTheme?.terminalTheme, theme)
  const effectiveTerminalAppTheme = resolveTerminalAppThemeMode(workspaceTheme?.mode, effectiveAppTheme)
  const resolvedCompletionConfig = completionConfig ?? DEFAULT_COMPLETION_CONFIG
  const effectiveCompletionEnabled = completionEnabled && resolvedCompletionConfig.enabled
  const allowTerminalTransparency = transparentBackground

  const terminalFontFamily = formatTerminalFontFamily(fontFamily)
  const { terminalTheme, terminalRendererTheme } = useMemo(() => {
    void themeModeVersion
    return resolveTerminalRendererTheme({
      theme: effectiveTerminalTheme,
      appTheme: effectiveTerminalAppTheme,
      transparentBackground,
    })
  }, [effectiveTerminalAppTheme, effectiveTerminalTheme, themeModeVersion, transparentBackground])

  const { terminal, fitAddon, terminalReady, containerRef, isClient } = useTerminalInstance(
    sessionId,
    {
      theme: terminalRendererTheme,
      fontSize,
      fontFamily: terminalFontFamily,
      cursorStyle,
      cursorBlink,
      scrollback,
      enableWebgl,
      allowTransparency: allowTerminalTransparency,
      fontWeight,
      fontWeightBold,
    },
    true
  )

  const isTerminalReadyRef = useRef(false)
  const sendInputRef = useRef<(data: string) => void>(() => {})
  const completionUpdateSenderRef = useRef<((command: string) => void) | null>(null)
  const osc7CwdRef = useRef<string | undefined>(undefined)

  const resolvedCompletionProviderEnabled = useMemo(() => completionProviderEnabled ?? ({
    local: !!resolvedCompletionConfig.providers.local,
    session: !!resolvedCompletionConfig.providers.session || !!resolvedCompletionConfig.providers.history,
    script: !!resolvedCompletionConfig.providers.script,
    remoteHistory: !!resolvedCompletionConfig.providers.remote,
    path: !!resolvedCompletionConfig.providers.path,
  }), [
    completionProviderEnabled,
    resolvedCompletionConfig.providers.history,
    resolvedCompletionConfig.providers.local,
    resolvedCompletionConfig.providers.path,
    resolvedCompletionConfig.providers.remote,
    resolvedCompletionConfig.providers.script,
    resolvedCompletionConfig.providers.session,
  ])

  const getPathCompletionCwd = useCallback(
    () => osc7CwdRef.current ?? pathCompletionCwd,
    [pathCompletionCwd],
  )

  useEffect(() => {
    osc7CwdRef.current = undefined
  }, [serverId, sessionId])

  useEffect(() => {
    if (!terminal) return

    const disposable = terminal.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7Cwd(data)
      if (!cwd) {
        return false
      }

      osc7CwdRef.current = cwd
      return true
    })

    return () => {
      disposable.dispose()
    }
  }, [terminal])

  const effectiveAuthFlowAdapters = useTerminalAuthFlowAdapters({ authFlowAdapters })
  const terminalAuthTicketProvider = useMemo(
    () => createWorkspaceTerminalAuthTicketProviderAdapter(workspace?.adapters.authTicketProvider),
    [workspace?.adapters.authTicketProvider],
  )
  const authFlow = useTerminalAuthFlow({
    serverId,
    serverName,
    tTerminal,
    adapters: effectiveAuthFlowAdapters,
    onAuthCancelled,
  })

  const terminalCompletion = useTerminalCompletionController({
    sessionId,
    terminal,
    serverId,
    pathCompletionApi: workspace?.adapters.apiClient?.sftp,
    getPathCompletionCwd,
    terminalReady,
    isTerminalReadyRef,
    containerRef,
    completionConfig: resolvedCompletionConfig,
    effectiveCompletionEnabled,
    completionTrigger,
    completionAutoDelay,
    completionMaxItems,
    completionShowIcon,
    completionShowDescription,
    providerEnabled: resolvedCompletionProviderEnabled,
    completionFetchOptions,
    sendInputRef,
    completionUpdateSenderRef,
    onCommand,
  })

  const { resize } = useTerminalConnectionController({
    sessionId,
    serverId,
    shouldConnect,
    isActive,
    terminal,
    tTerminal,
    completion: terminalCompletion,
    auth: authFlow,
    isTerminalReadyRef,
    sendInputRef,
    completionUpdateSenderRef,
    onConnectionPhaseChange,
    createAuthTicket: terminalAuthTicketProvider,
    createWebSocketUrl: workspaceTerminalApi?.createWebSocketUrl,
    WebSocketCtor: workspaceTerminalApi?.WebSocketCtor,
  })

  useTerminalRendererSettings({
    terminal,
    fitAddon,
    terminalReady,
    terminalRendererTheme,
    allowTransparency: allowTerminalTransparency,
    themeModeVersion,
    fontSize,
    fontFamily: terminalFontFamily,
    fontWeight,
    fontWeightBold,
    cursorStyle,
    cursorBlink,
    scrollback,
  })

  const writePrompt = useCallback((term: Terminal) => {
    const hostShort = host.split(".")[0] || host
    term.write(`\x1b[1;32m${username}\x1b[0m\x1b[2m@\x1b[0m\x1b[1;36m${hostShort}\x1b[0m \x1b[1;34m~\x1b[0m\x1b[1;35m $\x1b[0m `)
  }, [host, username])

  useTerminalAutoFit({
    terminal,
    fitAddon,
    containerRef,
    isActive,
    terminalReady,
    onTerminalResize: resize,
    onResize,
  })

  useTerminalContainerApi({
    terminal,
    fitAddon,
    containerRef,
    writePrompt,
    onInputApiChange,
  })

  useTerminalInputActions({
    terminal,
    terminalReady,
    containerRef,
    copyOnSelect,
    rightClickPaste,
    copyShortcut,
    pasteShortcut,
    clearShortcut,
  })

  if (!isClient) {
    return (
      <div className="h-full w-full bg-background flex items-center justify-center">
        <ConnectionLoader
          serverName={serverName}
          message={tTerminal("connectionLoaderInitializing")}
        />
      </div>
    )
  }

  return (
    <div
      className="h-full w-full min-w-0 relative overflow-hidden"
      data-terminal-transparent-background={allowTerminalTransparency ? "true" : "false"}
    >
      <div
        ref={containerRef}
        className="h-full w-full min-w-0 terminal-container"
      />

      {terminalCompletion.completionState.visible && terminal && (
        <TerminalThemeProvider theme={terminalTheme}>
          <CompletionPopup
            items={terminalCompletion.completionState.items}
            selectedIndex={terminalCompletion.completionState.selectedIndex}
            position={terminalCompletion.completionState.position}
            matchedPrefix={terminalCompletion.completionState.matchedPrefix}
            showIcon={completionShowIcon}
            onSelect={terminalCompletion.applyCompletionItem}
            onClose={terminalCompletion.closeCompletion}
            onPlacementChange={terminalCompletion.setCompletionPlacement}
          />
        </TerminalThemeProvider>
      )}

      <TerminalAuthChallengeDialog
        prompt={authFlow.authChallenge?.prompt ?? null}
        serverName={`${username}@${host}`}
        onSubmit={authFlow.handleAuthChallengeSubmit}
        onCancel={authFlow.handleAuthChallengeCancel}
      />

      <TerminalHostKeyDialog
        prompt={authFlow.hostKeyWarning?.prompt ?? null}
        isTrusting={authFlow.hostKeyTrusting}
        labels={{
          title: tTerminal("hostKeyChangedTitle"),
          description: tTerminal("hostKeyChangedDescription", { server: serverName }),
          expected: tTerminal("hostKeyChangedExpected"),
          received: tTerminal("hostKeyChangedReceived"),
          risk: tTerminal("hostKeyChangedRisk"),
          cancel: tTerminal("hostKeyChangedCancel"),
          trust: tTerminal("hostKeyChangedTrust"),
          trusting: tTerminal("hostKeyChangedTrusting"),
        }}
        onCancel={authFlow.handleCancelHostKey}
        onTrust={authFlow.handleTrustHostKey}
      />

      <style>{`
        .terminal-container {
          /* 阻断终端滚动向页面的滚动链传递 */
          overscroll-behavior: contain;
          overscroll-behavior-y: contain;
        }
        [data-terminal-transparent-background="true"] .terminal-container .xterm,
        [data-terminal-transparent-background="true"] .terminal-container .xterm-screen,
        [data-terminal-transparent-background="true"] .terminal-container .xterm-viewport {
          background: transparent !important;
        }
        .terminal-container .xterm {
          padding: 16px;
        }
        @media (max-width: 767px) {
          .terminal-container .xterm {
            padding: 12px;
          }
        }
        .terminal-container .xterm-screen {
          border-radius: 0;
        }
        .terminal-container .xterm-viewport {
          /* 在终端滚动到边界时，不继续滚动外层页面 */
          overscroll-behavior: contain;
          overscroll-behavior-y: contain;
          scrollbar-width: thin;
          scrollbar-color: #3f3f46 transparent;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar {
          width: 10px;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-track {
          background: transparent;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: #3f3f46;
          border-radius: 5px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background-color: #52525b;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        /* 光标增强效果 */
        .terminal-container .xterm-cursor-layer .xterm-cursor {
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
        }
      `}</style>
    </div>
  )
}
