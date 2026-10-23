
import { useCallback, useEffect, useMemo, type RefObject } from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"

export interface TerminalContainerApiElement extends HTMLDivElement {
  writeToTerminal?: (text: string) => void
  clearTerminal?: () => void
  fitTerminal?: () => void
}

export interface TerminalInputApi {
  insertText: (text: string) => void
  executeCommand: (command: string) => void
  applyScript: (content: string, execute: boolean) => void
  focus: () => void
  toggleSearch: () => void
}

export interface UseTerminalContainerApiOptions {
  terminal: Terminal | null | undefined
  fitAddon: FitAddon | null | undefined
  containerRef: RefObject<HTMLDivElement | null>
  writePrompt: (terminal: Terminal) => void
  onToggleSearch: () => void
  onInputApiChange?: (api: TerminalInputApi | null) => void
}

export function useTerminalContainerApi({
  terminal,
  fitAddon,
  containerRef,
  writePrompt,
  onToggleSearch,
  onInputApiChange,
}: UseTerminalContainerApiOptions) {
  const writeToTerminal = useCallback((text: string) => {
    terminal?.writeln(text)
  }, [terminal])

  const clearTerminal = useCallback(() => {
    if (!terminal) return

    terminal.clear()
    writePrompt(terminal)
  }, [terminal, writePrompt])

  const fitTerminal = useCallback(() => {
    fitAddon?.fit()
  }, [fitAddon])

  const inputApi = useMemo<TerminalInputApi>(() => ({
    insertText: (text) => {
      terminal?.input(text, true)
      terminal?.focus()
    },
    executeCommand: (command) => {
      terminal?.input(`${command}\r`, true)
      terminal?.focus()
    },
    applyScript: (content, execute) => {
      if (!terminal || !content.trim()) return
      // 移到行尾再清空输入，避免脚本拼接到尚未提交的命令上。
      terminal.input("\x05", true)
      terminal.input("\x15", true)
      // 交给 xterm 处理换行和 bracketed paste，保留多行脚本内容。
      terminal.paste(content.replace(/\r\n?/g, "\n").trimEnd())
      if (execute) terminal.input("\r", true)
      terminal.focus()
    },
    focus: () => terminal?.focus(),
    toggleSearch: onToggleSearch,
  }), [onToggleSearch, terminal])

  useEffect(() => {
    const container = containerRef.current as TerminalContainerApiElement | null
    if (!container) return

    container.writeToTerminal = writeToTerminal
    container.clearTerminal = clearTerminal
    container.fitTerminal = fitTerminal
  }, [containerRef, writeToTerminal, clearTerminal, fitTerminal])

  useEffect(() => {
    onInputApiChange?.(terminal ? inputApi : null)
    return () => onInputApiChange?.(null)
  }, [inputApi, onInputApiChange, terminal])

  return {
    writeToTerminal,
    clearTerminal,
    fitTerminal,
  }
}
