import { useState } from "react"
import { Activity, FileText, FolderOpen, ScrollText, TextSelect, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type ComposerContextReferenceKind = "terminal-selection" | "terminal-output" | "working-directory" | "monitor-snapshot"

export interface ComposerContextReference {
  id: string
  kind: ComposerContextReferenceKind
  label: string
  content: string
}

function ReferenceIcon({ kind }: { kind: ComposerContextReferenceKind }) {
  if (kind === "terminal-selection") return <TextSelect className="size-3.5" />
  if (kind === "terminal-output") return <ScrollText className="size-3.5" />
  if (kind === "working-directory") return <FolderOpen className="size-3.5" />
  if (kind === "monitor-snapshot") return <Activity className="size-3.5" />
  return <FileText className="size-3.5" />
}

export function ComposerContextReferences({
  references,
  onRemove,
}: {
  references: ComposerContextReference[]
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation("aiAssistant")
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = references.find((reference) => reference.id === previewId)
  if (references.length === 0) return null

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5 px-1">
        {references.map((reference) => (
          <span
            key={reference.id}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/45 px-1.5 py-1 text-xs text-foreground"
          >
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1 text-left outline-none hover:text-primary focus-visible:text-primary"
              onClick={() => setPreviewId(reference.id)}
            >
              <ReferenceIcon kind={reference.kind} />
              <span className="max-w-40 truncate">{reference.label}</span>
            </button>
            <TooltipIconButton
              type="button"
              className="size-5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => onRemove(reference.id)}
              tooltip={t("removeContext", { label: reference.label })}
            >
              <X className="size-3" />
            </TooltipIconButton>
          </span>
        ))}
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewId(null)}>
        {preview && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{preview.label}</DialogTitle>
              <DialogDescription>{t("contextPreviewDescription", { count: preview.content.length })}</DialogDescription>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/35 p-3 font-mono text-xs leading-5">
              {preview.content}
            </pre>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
