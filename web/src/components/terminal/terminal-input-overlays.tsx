import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type { Terminal } from "@xterm/xterm"
import { SearchAddon } from "@xterm/addon-search"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function TerminalSearch({
  terminal,
  inputRef,
  open,
  onClose,
}: {
  terminal: Terminal | null | undefined
  inputRef: RefObject<HTMLInputElement | null>
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation("terminalSettings")
  const addonRef = useRef<SearchAddon | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    right: number
    top: number
  } | null>(null)
  const [position, setPosition] = useState({ right: 8, top: 8 })
  const clampPosition = useCallback((next: { right: number; top: number }) => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!panel || !parent) return next
    return {
      right: Math.min(Math.max(8, next.right), Math.max(8, parent.clientWidth - panel.offsetWidth - 8)),
      top: Math.min(Math.max(8, next.top), Math.max(8, parent.clientHeight - panel.offsetHeight - 8)),
    }
  }, [])
  useLayoutEffect(() => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!open || !panel || !parent) return
    const constrain = () => setPosition(current => {
      const next = clampPosition(current)
      return next.right === current.right && next.top === current.top ? current : next
    })
    constrain()
    const observer = new ResizeObserver(constrain)
    observer.observe(parent)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      dragRef.current = null
    }
  }, [clampPosition, open])
  const [query, setQuery] = useState("")
  const [found, setFound] = useState(true)
  useEffect(() => {
    if (!terminal || !open) return
    const addon = new SearchAddon()
    terminal.loadAddon(addon)
    addonRef.current = addon
    inputRef.current?.focus()
    return () => {
      addon.clearDecorations()
      addon.dispose()
      addonRef.current = null
    }
  }, [terminal, open, inputRef])
  useEffect(() => {
    if (!open) return
    if (!query) {
      addonRef.current?.clearDecorations()
      setFound(true)
      return
    }
    setFound(addonRef.current?.findNext(query, { incremental: true }) ?? false)
  }, [open, query])
  const find = (previous: boolean) => {
    if (!query) return
    setFound(
      (previous ? addonRef.current?.findPrevious(query) : addonRef.current?.findNext(query)) ??
        false,
    )
  }
  if (!open) return null
  return (
    <div
      ref={panelRef}
      role="search"
      aria-label={t("findShortcut")}
      className="absolute z-40 flex w-[360px] max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 overflow-y-auto rounded-md border bg-background p-2 shadow-lg"
      style={position}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
          terminal?.focus()
        }
        if (event.key === "Enter" && event.target === inputRef.current) {
          event.preventDefault()
          find(event.shiftKey)
        }
      }}
    >
      <button
        type="button"
        aria-label={t("searchMove")}
        title={t("searchMove")}
        className="flex h-8 w-5 shrink-0 touch-none select-none items-center justify-center rounded cursor-grab text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...position }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          const parent = panelRef.current?.parentElement
          if (!drag || drag.pointerId !== event.pointerId || !parent) return
          const bounds = parent.getBoundingClientRect()
          if (!bounds.width || !bounds.height) return
          setPosition(clampPosition({
            right: drag.right - (event.clientX - drag.x) * parent.clientWidth / bounds.width,
            top: drag.top + (event.clientY - drag.y) * parent.clientHeight / bounds.height,
          }))
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return
          dragRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { dragRef.current = null }}
        onLostPointerCapture={() => { dragRef.current = null }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10
          const offsets: Record<string, { right: number; top: number }> = {
            ArrowLeft: { right: step, top: 0 },
            ArrowRight: { right: -step, top: 0 },
            ArrowUp: { right: 0, top: -step },
            ArrowDown: { right: 0, top: step },
          }
          const offset = offsets[event.key]
          if (!offset) return
          event.preventDefault()
          event.stopPropagation()
          setPosition(current => clampPosition({ right: current.right + offset.right, top: current.top + offset.top }))
        }}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        ref={inputRef}
        className="min-w-0 flex-1"
        value={query}
        aria-label={t("searchPlaceholder")}
        placeholder={t("searchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("searchPrevious")}
        onClick={() => find(true)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label={t("searchNext")} onClick={() => find(false)}>
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("searchClose")}
        onClick={() => {
          onClose()
          terminal?.focus()
        }}
      >
        <X className="h-4 w-4" />
      </Button>
      {!found && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {t("searchNoResults")}
        </p>
      )}
    </div>
  )
}

export function TerminalPasteConfirmation({
  text,
  onFinish,
}: {
  text: string | null
  onFinish: (approved: boolean) => void
}) {
  const { t } = useTranslation("terminalSettings")
  return (
    <AlertDialog
      open={text !== null}
      onOpenChange={(open) => {
        if (!open) onFinish(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pasteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("pasteConfirmHelp", {
              lines: text?.split(/\r\n|\r|\n/).length ?? 0,
              chars: text?.length ?? 0,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted p-3 text-xs">
          {text?.slice(0, 3000)}
          {text && text.length > 3000 ? "\n…" : ""}
        </pre>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("btnCancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onFinish(true)}>
            {t("pasteConfirmAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
