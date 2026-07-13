
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react"
import type { Terminal } from "@xterm/xterm"
import { CompletionEngine } from "@/lib/completion/completion-engine"
import { LocalCommandProvider } from "@/lib/completion/providers/local-command-provider"
import {
  PathProvider,
  PATH_COMPLETION_COMMANDS,
} from "@/lib/completion/providers/path-provider"
import { RemoteHistoryProvider } from "@/lib/completion/providers/remote-history-provider"
import { ScriptProvider } from "@/lib/completion/providers/script-provider"
import { SessionProvider } from "@/lib/completion/providers/session-provider"
import type {
  CompletionConfig,
  CompletionContext,
  CompletionItem,
} from "@/lib/completion/types"
import type { SftpDirectoryApi } from "@/lib/session/sftp-directory"
import {
  applyCompletion,
  getCommandNameFromToken,
  getCursorScreenPosition,
  isBackspaceKey,
  isDownArrow,
  isEnterKey,
  isEscapeKey,
  isShellAssignmentToken,
  isShellOptionToken,
  isTabKey,
  isUpArrow,
  parseCompletionContext,
  parseCompletionContextFromCommand,
  stripOuterQuote,
  unescapeShellToken,
} from "@/lib/completion/utils"
import type {
  CompletionDataResponse,
  CompletionFetchOptions,
  CompletionUpdateResponse,
} from "@/lib/websocket-terminal"

export type CompletionPlacement = "top" | "bottom"

export interface TerminalCompletionProviderFlags {
  local: boolean
  session: boolean
  script: boolean
  remoteHistory: boolean
  path: boolean
}

export interface TerminalCompletionState {
  visible: boolean
  items: CompletionItem[]
  selectedIndex: number
  position: { x: number; y: number; lineTop?: number; lineBottom?: number }
  matchedPrefix: string
}

export interface UseTerminalCompletionControllerOptions {
  sessionId: string
  terminal: Terminal | null | undefined
  serverId?: string
  pathCompletionApi?: SftpDirectoryApi
  getPathCompletionCwd?: () => string | undefined
  terminalReady: boolean
  isTerminalReadyRef: MutableRefObject<boolean>
  containerRef: RefObject<HTMLDivElement | null>
  completionConfig: CompletionConfig
  effectiveCompletionEnabled: boolean
  completionTrigger: "tab" | "auto"
  completionAutoDelay: number
  completionMaxItems: number
  completionShowIcon: boolean
  completionShowDescription: boolean
  providerEnabled: TerminalCompletionProviderFlags
  completionFetchOptions?: CompletionFetchOptions
  sendInputRef: MutableRefObject<(data: string) => void>
  completionUpdateSenderRef: MutableRefObject<((command: string) => void) | null>
  onCommand: (command: string) => void
}

export interface UseTerminalCompletionControllerResult {
  completionState: TerminalCompletionState
  closeCompletion: () => void
  applyCompletionItem: (item: CompletionItem) => void
  setCompletionPlacement: Dispatch<SetStateAction<CompletionPlacement>>
  handleCompletionData: (data: CompletionDataResponse) => void
  handleCompletionUpdate: (data: CompletionUpdateResponse) => void
  clearProviderData: () => void
  enableCompletionFetch: boolean
  completionFetchOptions?: CompletionFetchOptions
}

const emptyCompletionState: TerminalCompletionState = {
  visible: false,
  items: [],
  selectedIndex: 0,
  position: { x: 0, y: 0 },
  matchedPrefix: "",
}

const PATH_COMMAND_PREFIXES = new Set(["command", "env", "nice", "nohup", "sudo", "time"])
const CURSOR_LEFT = "\x1b[D"
const CURSOR_RIGHT = "\x1b[C"
const CURSOR_HOME = new Set(["\x1b[H", "\x1b[1~", "\x1bOH"])
const CURSOR_END = new Set(["\x1b[F", "\x1b[4~", "\x1bOF"])
const FORWARD_DELETE = "\x1b[3~"

interface CompletionInputShadow {
  active: boolean
  line: string
  cursor: number
}

function applyInputToCompletionShadow(
  current: CompletionInputShadow,
  data: string,
): CompletionInputShadow {
  if (isEnterKey(data) || data === "\x03") {
    return { active: true, line: "", cursor: 0 }
  }
  if (data === "\x01") {
    return { ...current, active: true, cursor: 0 }
  }
  if (data === "\x05") {
    return { ...current, active: true, cursor: current.line.length }
  }
  if (data === "\x15") {
    return {
      active: true,
      line: current.line.slice(current.cursor),
      cursor: 0,
    }
  }
  if (data === "\x0b") {
    return {
      active: true,
      line: current.line.slice(0, current.cursor),
      cursor: current.cursor,
    }
  }
  if (data === "\x17") {
    let start = current.cursor
    while (start > 0 && /\s/.test(current.line[start - 1])) start--
    while (start > 0 && !/\s/.test(current.line[start - 1])) start--
    return {
      active: true,
      line: current.line.slice(0, start) + current.line.slice(current.cursor),
      cursor: start,
    }
  }
  if (isBackspaceKey(data)) {
    if (current.cursor <= 0) return { ...current, active: true }
    return {
      active: true,
      line: current.line.slice(0, current.cursor - 1) + current.line.slice(current.cursor),
      cursor: current.cursor - 1,
    }
  }
  if (data === FORWARD_DELETE) {
    if (current.cursor >= current.line.length) return { ...current, active: true }
    return {
      active: true,
      line: current.line.slice(0, current.cursor) + current.line.slice(current.cursor + 1),
      cursor: current.cursor,
    }
  }
  if (data === CURSOR_LEFT) {
    return { ...current, active: true, cursor: Math.max(0, current.cursor - 1) }
  }
  if (data === CURSOR_RIGHT) {
    return { ...current, active: true, cursor: Math.min(current.line.length, current.cursor + 1) }
  }
  if (CURSOR_HOME.has(data)) {
    return { ...current, active: true, cursor: 0 }
  }
  if (CURSOR_END.has(data)) {
    return { ...current, active: true, cursor: current.line.length }
  }

  let text = data
  if (text.startsWith("\x1b[200~") && text.endsWith("\x1b[201~")) {
    text = text.slice(6, -6)
  }
  const hasControlCharacter = Array.from(text).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!text || hasControlCharacter) {
    return { ...current, active: false }
  }

  return {
    active: true,
    line: current.line.slice(0, current.cursor) + text + current.line.slice(current.cursor),
    cursor: current.cursor + text.length,
  }
}

function isPathArgumentCompletionContext(context: CompletionContext): boolean {
  for (let index = 0; index < context.tokens.length; index++) {
    const token = context.tokens[index]
    if (!token || isShellOptionToken(token)) {
      continue
    }

    const commandName = getCommandNameFromToken(token)
    if (PATH_COMMAND_PREFIXES.has(commandName) || isShellAssignmentToken(token)) {
      continue
    }

    return PATH_COMPLETION_COMMANDS.has(commandName) && context.currentTokenIndex >= index
  }

  return false
}

function getPathCompletionMatchedPrefix(context: CompletionContext): string {
  const wordPrefix = context.currentWord.slice(
    0,
    Math.max(0, context.cursorPosition - context.currentWordStart)
  )
  const unquotedPrefix = stripOuterQuote(wordPrefix)
  const unescapedPrefix = unescapeShellToken(unquotedPrefix)
  const slashIndex = unescapedPrefix.lastIndexOf("/")
  return slashIndex >= 0 ? unescapedPrefix.slice(slashIndex + 1) : unescapedPrefix
}

function getCompletionMatchedPrefix(
  context: CompletionContext,
  items: CompletionItem[]
): string {
  if (items.some((item) => item.source === "path")) {
    return getPathCompletionMatchedPrefix(context)
  }

  const rawPrefix = context.fullLine.slice(
    0,
    Math.min(context.cursorPosition, context.fullLine.length)
  )
  const linePrefix = rawPrefix.trim()
  return linePrefix || context.currentWord
}

export function useTerminalCompletionController({
  sessionId,
  terminal,
  serverId,
  pathCompletionApi,
  getPathCompletionCwd,
  terminalReady,
  isTerminalReadyRef,
  containerRef,
  completionConfig,
  effectiveCompletionEnabled,
  completionTrigger,
  completionAutoDelay,
  completionMaxItems,
  completionShowIcon,
  completionShowDescription,
  providerEnabled,
  completionFetchOptions,
  sendInputRef,
  completionUpdateSenderRef,
  onCommand,
}: UseTerminalCompletionControllerOptions): UseTerminalCompletionControllerResult {
  const completionEngineRef = useRef<CompletionEngine | null>(null)
  const completionEngineSessionIdRef = useRef<string | null>(null)
  const remoteHistoryProviderRef = useRef<RemoteHistoryProvider | null>(null)
  const scriptProviderRef = useRef<ScriptProvider | null>(null)
  const sessionProviderRef = useRef<SessionProvider | null>(null)
  const pathProviderRef = useRef<PathProvider | null>(null)
  const inputShadowRef = useRef<CompletionInputShadow>({ active: false, line: "", cursor: 0 })
  const autoCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionRequestVersionRef = useRef(0)
  const handleCompletionRequestRef = useRef<(
    (triggerKind?: CompletionContext["triggerKind"]) => Promise<boolean>
  ) | undefined>(undefined)
  const onCommandRef = useRef(onCommand)
  const [completionState, setCompletionState] = useState<TerminalCompletionState>(emptyCompletionState)
  const [completionPlacement, setCompletionPlacement] = useState<CompletionPlacement>("bottom")
  const completionPlacementRef = useRef<CompletionPlacement>("bottom")
  const completionStateRef = useRef(completionState)
  const providerLocalEnabled = providerEnabled.local
  const providerSessionEnabled = providerEnabled.session
  const providerScriptEnabled = providerEnabled.script
  const providerRemoteHistoryEnabled = providerEnabled.remoteHistory
  const providerPathEnabled = providerEnabled.path

  useEffect(() => {
    completionPlacementRef.current = completionPlacement
  }, [completionPlacement])

  useEffect(() => {
    completionStateRef.current = completionState
  }, [completionState])

  useEffect(() => {
    onCommandRef.current = onCommand
  }, [onCommand])

  const getMergedConfig = useCallback((): CompletionConfig => ({
    ...completionConfig,
    trigger: completionTrigger,
    autoTriggerDelay: completionAutoDelay,
    maxItems: completionMaxItems,
    showIcon: completionShowIcon,
    showDescription: completionShowDescription,
  }), [
    completionAutoDelay,
    completionConfig,
    completionMaxItems,
    completionShowDescription,
    completionShowIcon,
    completionTrigger,
  ])

  const getCompletionContext = useCallback((
    triggerKind?: CompletionContext["triggerKind"],
  ): CompletionContext | null => {
    if (!terminal) return null

    const options = {
      cwd: getPathCompletionCwd?.(),
      triggerKind,
    }
    const shadow = inputShadowRef.current
    if (!shadow.active) {
      return parseCompletionContext(terminal, options)
    }

    const shadowContext = parseCompletionContextFromCommand(shadow.line, shadow.cursor, options)
    const liveContext = parseCompletionContext(terminal, options)
    return {
      ...shadowContext,
      promptText: liveContext.promptText,
    }
  }, [getPathCompletionCwd, terminal])

  const updateInputShadow = useCallback((data: string) => {
    if (!terminal) return

    let current = inputShadowRef.current
    if (!current.active) {
      const context = parseCompletionContext(terminal, {
        cwd: getPathCompletionCwd?.(),
      })
      current = {
        active: true,
        line: context.fullLine,
        cursor: context.cursorPosition,
      }
    }
    inputShadowRef.current = applyInputToCompletionShadow(current, data)
  }, [getPathCompletionCwd, terminal])

  const syncProviderEnabledState = useCallback((engine: CompletionEngine) => {
    engine.setProviderEnabled("local", effectiveCompletionEnabled && providerLocalEnabled)
    engine.setProviderEnabled("session", effectiveCompletionEnabled && providerSessionEnabled)
    engine.setProviderEnabled("script", effectiveCompletionEnabled && providerScriptEnabled)
    engine.setProviderEnabled("remote-history", effectiveCompletionEnabled && providerRemoteHistoryEnabled)
    engine.setProviderEnabled(
      "path",
      effectiveCompletionEnabled && providerPathEnabled && !!serverId && !!pathCompletionApi
    )
  }, [
    effectiveCompletionEnabled,
    pathCompletionApi,
    providerLocalEnabled,
    providerPathEnabled,
    providerRemoteHistoryEnabled,
    providerScriptEnabled,
    providerSessionEnabled,
    serverId,
  ])

  const createCompletionEngine = useCallback((targetSessionId: string) => {
    const engine = new CompletionEngine(targetSessionId, getMergedConfig())

    engine.registerProvider(new LocalCommandProvider())

    const sessionProvider = new SessionProvider()
    sessionProviderRef.current = sessionProvider
    engine.registerProvider(sessionProvider)

    const scriptProvider = new ScriptProvider()
    scriptProviderRef.current = scriptProvider
    engine.registerProvider(scriptProvider)

    const pathProvider = new PathProvider({
      serverId,
      api: pathCompletionApi,
      getFallbackCwd: getPathCompletionCwd,
    })
    pathProviderRef.current = pathProvider
    engine.registerProvider(pathProvider)

    const remoteHistoryProvider = new RemoteHistoryProvider()
    remoteHistoryProviderRef.current = remoteHistoryProvider
    engine.registerProvider(remoteHistoryProvider)

    syncProviderEnabledState(engine)
    completionEngineRef.current = engine
    completionEngineSessionIdRef.current = targetSessionId
  }, [getMergedConfig, getPathCompletionCwd, pathCompletionApi, serverId, syncProviderEnabledState])

  useEffect(() => {
    if (completionEngineRef.current && completionEngineSessionIdRef.current === sessionId) {
      return
    }

    if (autoCompleteTimerRef.current) {
      clearTimeout(autoCompleteTimerRef.current)
      autoCompleteTimerRef.current = null
    }
    completionRequestVersionRef.current++
    inputShadowRef.current = { active: false, line: "", cursor: 0 }
    setCompletionState(emptyCompletionState)
    createCompletionEngine(sessionId)
  }, [createCompletionEngine, sessionId])

  useEffect(() => {
    if (!completionEngineRef.current) return

    completionEngineRef.current.updateConfig(getMergedConfig())
    pathProviderRef.current?.updateOptions({
      serverId,
      api: pathCompletionApi,
      getFallbackCwd: getPathCompletionCwd,
    })
    syncProviderEnabledState(completionEngineRef.current)
    completionEngineRef.current.clearCache()
  }, [
    getMergedConfig,
    getPathCompletionCwd,
    pathCompletionApi,
    serverId,
    syncProviderEnabledState,
  ])

  const clearProviderData = useCallback(() => {
    remoteHistoryProviderRef.current?.clear()
    scriptProviderRef.current?.clear()
    sessionProviderRef.current?.clear()
    pathProviderRef.current?.clear()
    completionEngineRef.current?.clearCache()
  }, [])

  const handleCompletionData = useCallback((data: CompletionDataResponse) => {
    remoteHistoryProviderRef.current?.loadHistory(data.history, data.timestamp)
    scriptProviderRef.current?.loadScripts(data.scripts)
    completionEngineRef.current?.clearCache()
  }, [])

  const handleCompletionUpdate = useCallback((data: CompletionUpdateResponse) => {
    remoteHistoryProviderRef.current?.addCommand(data.newCommand)
    completionEngineRef.current?.clearCache()
  }, [])

  const resetCompletionState = useCallback(() => {
    setCompletionState(emptyCompletionState)
  }, [])

  const invalidateCompletionRequest = useCallback(() => {
    completionRequestVersionRef.current++
  }, [])

  const closeCompletion = useCallback(() => {
    invalidateCompletionRequest()
    resetCompletionState()
  }, [invalidateCompletionRequest, resetCompletionState])

  useEffect(() => {
    if (!effectiveCompletionEnabled && completionStateRef.current.visible) {
      closeCompletion()
    }
  }, [effectiveCompletionEnabled, closeCompletion])

  const applyCompletionItem = useCallback((item: CompletionItem) => {
    if (!terminal) return

    const context = getCompletionContext()
    if (!context) return
    const isFullLineCompletion = item.source === "script" || item.type === "history"
    let deleteCount: number
    let forwardDeleteCount = 0
    let completionText = item.text

    if (
      typeof item.replaceStart === "number" &&
      typeof item.replaceEnd === "number"
    ) {
      deleteCount = Math.max(0, context.cursorPosition - item.replaceStart)
      forwardDeleteCount = Math.max(0, item.replaceEnd - context.cursorPosition)
    } else if (isFullLineCompletion) {
      const clampedCursorPosition = Math.min(context.cursorPosition, context.fullLine.length)
      const linePrefix = context.fullLine.slice(0, clampedCursorPosition).trim()

      if (clampedCursorPosition >= context.fullLine.length && linePrefix && item.text.startsWith(linePrefix)) {
        deleteCount = 0
        completionText = item.text.slice(linePrefix.length)
      } else {
        deleteCount = clampedCursorPosition
        forwardDeleteCount = Math.max(0, context.fullLine.length - clampedCursorPosition)
      }
    } else {
      deleteCount = Math.max(0, context.cursorPosition - context.currentWordStart)
      forwardDeleteCount = Math.max(0, context.currentWordEnd - context.cursorPosition)
    }

    applyCompletion(
      terminal,
      completionText,
      deleteCount,
      sendInputRef.current,
      forwardDeleteCount
    )
    const replaceStart = Math.max(0, context.cursorPosition - deleteCount)
    const replaceEnd = Math.min(context.fullLine.length, context.cursorPosition + forwardDeleteCount)
    inputShadowRef.current = {
      active: true,
      line: context.fullLine.slice(0, replaceStart) + completionText + context.fullLine.slice(replaceEnd),
      cursor: replaceStart + completionText.length,
    }
    closeCompletion()
  }, [closeCompletion, getCompletionContext, sendInputRef, terminal])

  const handleCompletionRequest = useCallback(async (
    triggerKind: CompletionContext["triggerKind"] = "manual"
  ) => {
    if (!effectiveCompletionEnabled || !terminal || !completionEngineRef.current) {
      return false
    }

    const requestVersion = completionRequestVersionRef.current + 1
    completionRequestVersionRef.current = requestVersion

    const context = getCompletionContext(triggerKind)
    if (!context) {
      return false
    }

    try {
      const result = await completionEngineRef.current.getCompletions(context)

      if (requestVersion !== completionRequestVersionRef.current) {
        return true
      }

      if (!result || result.items.length === 0) {
        resetCompletionState()
        return false
      }

      const cursorPosition = getCursorScreenPosition(terminal, containerRef.current)
      const position = {
        x: cursorPosition.x,
        y: cursorPosition.y,
        lineTop: cursorPosition.lineTop,
        lineBottom: cursorPosition.lineBottom,
      }

      setCompletionState({
        visible: true,
        items: result.items,
        selectedIndex: 0,
        position,
        matchedPrefix: getCompletionMatchedPrefix(context, result.items),
      })
      return true
    } catch {
      if (requestVersion === completionRequestVersionRef.current) {
        resetCompletionState()
      }
      return false
    }
  }, [
    containerRef,
    effectiveCompletionEnabled,
    getCompletionContext,
    resetCompletionState,
    terminal,
  ])

  useEffect(() => {
    handleCompletionRequestRef.current = handleCompletionRequest
  }, [handleCompletionRequest])

  useEffect(() => {
    if (!terminal || !terminalReady) return

    const disposable = terminal.onData((data: string) => {
      if (!isTerminalReadyRef.current) return

      if (isTabKey(data)) {
        if (completionStateRef.current.visible) {
          const selectedItem = completionStateRef.current.items[completionStateRef.current.selectedIndex]
          if (selectedItem) {
            applyCompletionItem(selectedItem)
          }
          return
        }

        if (effectiveCompletionEnabled && completionTrigger === "tab") {
          void (async () => {
            const handled = await handleCompletionRequestRef.current?.("manual")
            if (!handled) {
              sendInputRef.current(data)
              onCommandRef.current(data)
            }
          })()
          return
        }

        sendInputRef.current(data)
        onCommandRef.current(data)
        return
      }

      if (completionStateRef.current.visible && isEscapeKey(data)) {
        closeCompletion()
        if (autoCompleteTimerRef.current) {
          clearTimeout(autoCompleteTimerRef.current)
          autoCompleteTimerRef.current = null
        }
        return
      }

      if (completionStateRef.current.visible) {
        if (isUpArrow(data)) {
          const isTopPlacement = completionPlacementRef.current === "top"
          setCompletionState((prev) => {
            const delta = isTopPlacement ? 1 : -1
            const nextIndex = prev.items.length > 0
              ? (prev.selectedIndex + delta + prev.items.length) % prev.items.length
              : 0
            if (nextIndex === prev.selectedIndex) return prev
            return { ...prev, selectedIndex: nextIndex }
          })
          return
        }

        if (isDownArrow(data)) {
          const isTopPlacement = completionPlacementRef.current === "top"
          setCompletionState((prev) => {
            const delta = isTopPlacement ? -1 : 1
            const nextIndex = prev.items.length > 0
              ? (prev.selectedIndex + delta + prev.items.length) % prev.items.length
              : 0
            if (nextIndex === prev.selectedIndex) return prev
            return { ...prev, selectedIndex: nextIndex }
          })
          return
        }

        if (isEnterKey(data)) {
          const selectedItem = completionStateRef.current.items[completionStateRef.current.selectedIndex]
          if (selectedItem) {
            applyCompletionItem(selectedItem)
          }
          return
        }

        closeCompletion()
      }

      const contextBeforeInput = isEnterKey(data) ? getCompletionContext() : null
      sendInputRef.current(data)
      onCommandRef.current(data)
      invalidateCompletionRequest()
      updateInputShadow(data)

      if (isEnterKey(data)) {
        if (autoCompleteTimerRef.current) {
          clearTimeout(autoCompleteTimerRef.current)
          autoCompleteTimerRef.current = null
        }

        const command = contextBeforeInput?.fullLine.trim() || ""

        if (command && sessionProviderRef.current) {
          sessionProviderRef.current.addCommand(command)
        }

        if (command && remoteHistoryProviderRef.current) {
          remoteHistoryProviderRef.current.addCommand(command)
        }

        if (command) {
          completionUpdateSenderRef.current?.(command)
        }

        return
      }

      if (!effectiveCompletionEnabled || completionTrigger !== "auto") {
        return
      }

      if (autoCompleteTimerRef.current) {
        clearTimeout(autoCompleteTimerRef.current)
        autoCompleteTimerRef.current = null
      }

      if (isBackspaceKey(data)) {
        closeCompletion()
        return
      }

      if (!data || data.length === 0) {
        return
      }
      const firstCharCode = data.charCodeAt(0)
      if (firstCharCode < 32 || firstCharCode === 127) {
        return
      }

      const shouldTriggerAfterSpace = data === " " &&
        (() => {
          const context = getCompletionContext()
          return !!context && isPathArgumentCompletionContext(context)
        })()
      if (data === " " && !shouldTriggerAfterSpace) {
        return
      }

      const delay = completionEngineRef.current?.getConfig().autoTriggerDelay ?? completionAutoDelay ?? 200
      autoCompleteTimerRef.current = setTimeout(() => {
        if (!effectiveCompletionEnabled || completionTrigger !== "auto") {
          autoCompleteTimerRef.current = null
          return
        }

        const context = getCompletionContext(shouldTriggerAfterSpace ? "space" : "auto")
        if (!context) {
          autoCompleteTimerRef.current = null
          return
        }
        const rawPrefix = context.fullLine.slice(
          0,
          Math.min(context.cursorPosition, context.fullLine.length)
        )
        const linePrefix = rawPrefix.trim()
        const effectivePrefix = linePrefix || context.currentWord

        if (shouldTriggerAfterSpace || (effectivePrefix && effectivePrefix.length >= 2)) {
          void handleCompletionRequestRef.current?.(shouldTriggerAfterSpace ? "space" : "auto")
        }

        autoCompleteTimerRef.current = null
      }, delay)
    })

    return () => {
      disposable.dispose()
      if (autoCompleteTimerRef.current) {
        clearTimeout(autoCompleteTimerRef.current)
        autoCompleteTimerRef.current = null
      }
    }
  }, [
    applyCompletionItem,
    closeCompletion,
    completionAutoDelay,
    completionTrigger,
    completionUpdateSenderRef,
    effectiveCompletionEnabled,
    getCompletionContext,
    invalidateCompletionRequest,
    isTerminalReadyRef,
    sendInputRef,
    terminal,
    terminalReady,
    updateInputShadow,
  ])

  return {
    completionState,
    closeCompletion,
    applyCompletionItem,
    setCompletionPlacement,
    handleCompletionData,
    handleCompletionUpdate,
    clearProviderData,
    enableCompletionFetch: effectiveCompletionEnabled && (providerRemoteHistoryEnabled || providerScriptEnabled),
    completionFetchOptions,
  }
}
