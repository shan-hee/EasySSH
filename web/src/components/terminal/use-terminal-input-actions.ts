import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import type { Terminal } from "@xterm/xterm"
import { useTranslation } from "react-i18next"
import { toast } from "@/components/ui/sonner"
import { DEFAULT_TERMINAL_SETTINGS } from "./terminal-settings"
import { matchesTerminalShortcut } from "./terminal-shortcuts"

export interface UseTerminalInputActionsOptions {
  terminal: Terminal | null | undefined
  terminalReady: boolean
  canSendInput: boolean
  isActive: boolean
  containerRef: RefObject<HTMLDivElement | null>
  copyOnSelect?: boolean
  rightClickPaste?: boolean
  multiLinePasteWarning?: boolean
  copyShortcut?: string
  pasteShortcut?: string
  clearShortcut?: string
  findShortcut?: string
  zoomInShortcut?: string
  zoomOutShortcut?: string
  zoomResetShortcut?: string
  onFind: () => void
  onZoom: (direction: "in" | "out" | "reset") => void
}

export function useTerminalInputActions(options: UseTerminalInputActionsOptions) {
  const { terminal, terminalReady, containerRef, canSendInput, isActive } = options
  const currentOptions = useRef(options)
  currentOptions.current = options
  const [pendingPaste, setPendingPaste] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const selectionByPointer = useRef(false)
  const selectionFrameRef = useRef<number | null>(null)
  const { t } = useTranslation("terminalSettings")

  const requestPaste = useCallback((text: string) => {
    const current = currentOptions.current
    if (!text || !current.terminal || !current.canSendInput || !current.isActive) return
    if (pendingRef.current !== null) return
    const needsConfirmation =
      (/[\r\n]/.test(text) && !current.terminal.modes.bracketedPasteMode) || text.length > 5000
    if ((current.multiLinePasteWarning ?? true) && needsConfirmation) {
      pendingRef.current = text
      setPendingPaste(text)
    } else current.terminal.paste(text)
  }, [])

  const finishPaste = useCallback((approved: boolean) => {
    const text = pendingRef.current
    pendingRef.current = null
    setPendingPaste(null)
    const current = currentOptions.current
    if (approved && text && current.canSendInput && current.isActive) current.terminal?.paste(text)
    current.terminal?.focus()
  }, [])

  useEffect(() => {
    if (!canSendInput || !isActive) {
      pendingRef.current = null
      setPendingPaste(null)
    }
  }, [canSendInput, isActive])

  const readClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard_unavailable")
      requestPaste(await navigator.clipboard.readText())
    } catch {
      toast.error(t("clipboardReadFailed"))
    }
  }, [requestPaste, t])

  const copySelection = useCallback(
    async (automatic = false) => {
      const selection = currentOptions.current.terminal?.getSelection()
      if (!selection) return
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable")
        await navigator.clipboard.writeText(selection)
      } catch {
        toast.error(t(automatic ? "clipboardAutoCopyFailed" : "clipboardCopyFailed"), {
          id: "terminal-copy-failed",
        })
      }
    },
    [t],
  )

  useEffect(() => {
    if (!terminal || !terminalReady) return
    const selection = terminal.onSelectionChange(() => {
      if (!currentOptions.current.isActive || !(currentOptions.current.copyOnSelect ?? true)) return
      // Search selections and keyboard navigation must not overwrite the clipboard.
      if (!selectionByPointer.current || selectionFrameRef.current !== null) return
      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null
        void copySelection(true)
      })
    })
    return () => {
      selection.dispose()
      if (selectionFrameRef.current !== null) cancelAnimationFrame(selectionFrameRef.current)
      selectionFrameRef.current = null
    }
  }, [copySelection, terminal, terminalReady])

  useEffect(() => {
    const root = containerRef.current?.querySelector<HTMLElement>(".xterm")
    if (!root || !terminalReady) return
    const onPointerDown = () => {
      selectionByPointer.current = true
    }
    const onPointerUp = () => {
      selectionByPointer.current = false
    }
    const onContextMenu = (event: MouseEvent) => {
      if (!(currentOptions.current.rightClickPaste ?? true) || !currentOptions.current.isActive)
        return
      event.preventDefault()
      void readClipboard()
    }
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      requestPaste(event.clipboardData?.getData("text/plain") ?? "")
    }
    root.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)
    root.addEventListener("contextmenu", onContextMenu)
    root.addEventListener("paste", onPaste, true)
    return () => {
      root.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
      root.removeEventListener("contextmenu", onContextMenu)
      root.removeEventListener("paste", onPaste, true)
    }
  }, [containerRef, readClipboard, requestPaste, terminalReady])

  useEffect(() => {
    if (!terminal || !terminalReady) return
    terminal.attachCustomKeyEventHandler((event) => {
      const current = currentOptions.current
      if (!current.isActive) return true
      const actions = {
        copyShortcut: () => {
          void copySelection()
        },
        pasteShortcut: () => {
          void readClipboard()
        },
        clearShortcut: () => terminal.clear(),
        findShortcut: current.onFind,
        zoomInShortcut: () => current.onZoom("in"),
        zoomOutShortcut: () => current.onZoom("out"),
        zoomResetShortcut: () => current.onZoom("reset"),
      }
      for (const key of Object.keys(actions) as (keyof typeof actions)[]) {
        if (!matchesTerminalShortcut(event, current[key] ?? DEFAULT_TERMINAL_SETTINGS[key]))
          continue
        event.preventDefault()
        if (event.type === "keydown") actions[key]()
        return false
      }
      return true
    })
    return () => {
      terminal.attachCustomKeyEventHandler(() => true)
    }
  }, [copySelection, readClipboard, terminal, terminalReady])

  return { pendingPaste, finishPaste }
}
