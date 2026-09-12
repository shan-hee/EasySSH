import { useEffect, useRef, useState } from "react"
import type { Terminal } from "@xterm/xterm"
import { SearchAddon } from "@xterm/addon-search"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, X } from "lucide-react"
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
  open,
  onClose,
}: {
  terminal: Terminal | null | undefined
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation("terminalSettings")
  const addonRef = useRef<SearchAddon | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
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
  }, [terminal, open])
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
      role="search"
      aria-label={t("findShortcut")}
      className="absolute right-2 top-2 z-40 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-md border bg-background p-2 shadow-lg"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
          terminal?.focus()
        }
        if (event.key === "Enter") {
          event.preventDefault()
          find(event.shiftKey)
        }
      }}
    >
      <Input
        ref={inputRef}
        className="w-44"
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
