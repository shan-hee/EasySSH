import { useState } from "react"
import { Activity, FolderOpen, ListPlus, ScrollText, TextSelect } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ComposerContextReference, ComposerContextReferenceKind } from "@/components/ai-agent/composer"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/components/ui/sonner"
import { useMonitorStore } from "@/stores/monitor-store"
import { useTerminalStore } from "@/stores/terminal-store"
import type { TerminalSession } from "./types"

const TERMINAL_SELECTION_LIMIT = 12_000
const TERMINAL_OUTPUT_LIMIT = 20_000
const TERMINAL_OUTPUT_LINES = 80

function createReference(kind: ComposerContextReferenceKind, label: string, content: string): ComposerContextReference {
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    label,
    content,
  }
}

function getRecentTerminalOutput(sessionId: string) {
  const terminal = useTerminalStore.getState().getTerminal(sessionId)?.terminal
  if (!terminal) return ""
  const buffer = terminal.buffer.active
  const start = Math.max(0, buffer.length - TERMINAL_OUTPUT_LINES)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)?.translateToString(true)
    if (line !== undefined) lines.push(line)
  }
  return lines.join("\n").trim().slice(-TERMINAL_OUTPUT_LIMIT)
}

export function TerminalAIContextPicker({
  disabled,
  onAdd,
  session,
}: {
  disabled?: boolean
  onAdd: (reference: ComposerContextReference) => void
  session: TerminalSession
}) {
  const { t } = useTranslation("aiAssistant")
  const [open, setOpen] = useState(false)

  const add = (kind: ComposerContextReferenceKind) => {
    const terminalState = useTerminalStore.getState().getTerminal(session.id)
    const metrics = kind === "monitor-snapshot" && session.serverId
      ? useMonitorStore.getState().getMetrics(session.serverId)
      : undefined
    const reference = kind === "terminal-selection"
      ? {
          content: terminalState?.terminal.getSelection().trim().slice(0, TERMINAL_SELECTION_LIMIT) ?? "",
          label: t("contextTerminalSelection"),
        }
      : kind === "terminal-output"
        ? { content: getRecentTerminalOutput(session.id), label: t("contextRecentOutput") }
        : kind === "working-directory"
          ? { content: terminalState?.cwd?.trim() ?? "", label: t("contextWorkingDirectory") }
          : {
              content: metrics ? JSON.stringify(metrics, null, 2) : "",
              label: t("contextMonitorSnapshot"),
            }

    if (!reference.content) {
      toast.info(t("contextUnavailable"))
      return
    }
    onAdd(createReference(kind, reference.label, reference.content))
    setOpen(false)
  }

  const options = [
    { kind: "terminal-selection" as const, label: t("contextTerminalSelection"), icon: TextSelect },
    { kind: "terminal-output" as const, label: t("contextRecentOutput"), icon: ScrollText },
    { kind: "working-directory" as const, label: t("contextWorkingDirectory"), icon: FolderOpen },
    { kind: "monitor-snapshot" as const, label: t("contextMonitorSnapshot"), icon: Activity },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md"
          disabled={disabled}
          aria-label={t("addContext")}
          title={t("addContext")}
        >
          <ListPlus className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-1.5">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("addContext")}</div>
        {options.map((option) => (
          <Button
            key={option.kind}
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 px-2 text-sm font-normal"
            onClick={() => add(option.kind)}
          >
            <option.icon className="size-4 text-muted-foreground" />
            {option.label}
          </Button>
        ))}
        <p className="px-2 pb-1 pt-2 text-[11px] leading-4 text-muted-foreground">{t("contextPrivacyHint")}</p>
      </PopoverContent>
    </Popover>
  )
}
