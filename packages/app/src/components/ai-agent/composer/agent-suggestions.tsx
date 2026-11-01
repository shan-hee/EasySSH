import { Activity, FileCode2, ScrollText, SquareTerminal } from "lucide-react"
import { useTranslation } from "react-i18next"
import { EmptyStateSuggestions, EmptyStateSuggestion } from "@/components/assistant-ui/elements/empty-state"

const templates = [
  { name: "RunCommand", icon: SquareTerminal },
  { name: "Script", icon: FileCode2 },
  { name: "Logs", icon: ScrollText },
  { name: "Perf", icon: Activity },
] as const

export function AgentSuggestions({ onUseTemplate }: { onUseTemplate: (prompt: string) => void }) {
  const { t } = useTranslation("aiAssistant")
  return (
    <EmptyStateSuggestions className="mt-4">
      {templates.map(({ name, icon: Icon }) => (
        <EmptyStateSuggestion
          key={name}
          className="inline-flex items-center gap-1.5"
          title={t(`template${name}Desc`)}
          onClick={() => onUseTemplate(t(`template${name}Prompt`))}
        >
          <Icon className="size-3.5 text-muted-foreground" />
          {t(`template${name}Title`)}
        </EmptyStateSuggestion>
      ))}
    </EmptyStateSuggestions>
  )
}
