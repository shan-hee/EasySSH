import { Brain } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { modelSelectorTriggerVariants } from "@/components/assistant-ui/elements/model-selector"
import type { ReasoningEffort } from "@/lib/ai-agent-types"
import { cn } from "@/lib/utils"

export function AgentReasoningSelector({ value, onValueChange, disabled }: {
  value: ReasoningEffort
  onValueChange: (value: ReasoningEffort) => void
  disabled?: boolean
}) {
  const { t } = useTranslation("aiAssistant")
  return (
    <Select value={value} onValueChange={(value) => onValueChange(value as ReasoningEffort)} disabled={disabled}>
      <SelectTrigger aria-label={t("reasoningEffort")} title={t("reasoningEffort")} size="sm" className={cn(modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }), "shrink-0 rounded-full text-muted-foreground")}>
        <Brain className="size-3.5" />
        <SelectValue>{t(`reasoningEffort_${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="terminal-ai-glass-popover w-52 rounded-xl">
        <SelectGroup>
          <SelectLabel>{t("reasoningEffort")}</SelectLabel>
          {(["auto", "low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
            <SelectItem key={effort} value={effort} textValue={t(`reasoningEffort_${effort}`)} className="rounded-md">
              {t(`reasoningEffort_${effort}`)}
              {effort === "auto" && (
                <span className="absolute right-8 text-xs text-muted-foreground">{t("reasoningEffort_default")}</span>
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
