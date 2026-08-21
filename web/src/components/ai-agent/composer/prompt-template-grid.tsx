
import type { TFunction } from "i18next"

import { useMemo } from "react"
import { ChevronRight, Code2, FileText, Sparkles, Terminal, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

type ComposerTranslate = TFunction

export function PromptTemplateGrid({
  onUseTemplate,
  t,
}: {
  onUseTemplate: (prompt: string) => void
  t: ComposerTranslate
}) {
  const templates = useMemo(
    () => [
      {
        icon: Terminal,
        titleKey: "templateRunCommandTitle",
        descKey: "templateRunCommandDesc",
        promptKey: "templateRunCommandPrompt",
      },
      {
        icon: Code2,
        titleKey: "templateScriptTitle",
        descKey: "templateScriptDesc",
        promptKey: "templateScriptPrompt",
      },
      {
        icon: FileText,
        titleKey: "templateLogsTitle",
        descKey: "templateLogsDesc",
        promptKey: "templateLogsPrompt",
      },
      {
        icon: Zap,
        titleKey: "templatePerfTitle",
        descKey: "templatePerfDesc",
        promptKey: "templatePerfPrompt",
      },
    ],
    []
  )

  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center">
        <div className="mb-5 flex size-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/8 text-primary">
          <Sparkles className="size-4" />
        </div>

        <h2 className="text-center text-xl font-semibold tracking-[-0.02em]">{t("emptyTitle")}</h2>
        <p className="mt-2 max-w-xl text-center text-sm leading-6 text-muted-foreground">
          {t("cardDescription")}
        </p>

        <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
          {templates.map((template) => {
            const Icon = template.icon
            return (
              <button
                key={template.titleKey}
                type="button"
                className={cn(
                  "group relative rounded-lg border border-border/55 bg-card/35 p-3.5 text-left transition-colors duration-150",
                  "hover:border-primary/30 hover:bg-muted/55 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                )}
                onClick={() => onUseTemplate(t(template.promptKey))}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/70 transition-colors group-hover:bg-primary/10">
                    <Icon className="size-4 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-medium"><span className="mr-1.5 text-primary">›</span>{t(template.titleKey)}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{t(template.descKey)}</div>
                  </div>
                </div>
                <ChevronRight className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
