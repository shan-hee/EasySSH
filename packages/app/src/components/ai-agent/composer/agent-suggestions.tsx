import { useTranslation } from "react-i18next"
import { EmptyStateSuggestions, EmptyStateSuggestion } from "@/components/assistant-ui/elements/empty-state"

const templates = ["RunCommand", "Script", "Logs", "Perf"] as const

export function AgentSuggestions({ onUseTemplate }: { onUseTemplate: (prompt: string) => void }) {
  const { t } = useTranslation("aiAssistant")
  return (
    <EmptyStateSuggestions className="mt-4">
      {templates.map((name) => (
        <EmptyStateSuggestion
          key={name}
          title={t(`template${name}Desc`)}
          onClick={() => onUseTemplate(t(`template${name}Prompt`))}
        >
          {t(`template${name}Title`)}
        </EmptyStateSuggestion>
      ))}
    </EmptyStateSuggestions>
  )
}
