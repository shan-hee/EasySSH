import { useMemo } from "react"
import { Sparkles } from "lucide-react"
import { ModelSelector } from "@/components/assistant-ui/elements/model-selector.aui"

export function AgentModelSelector({
  models,
  value,
  onValueChange,
  disabled
}: {
  models: string[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const options = useMemo(() => models.map((id) => ({ id, name: id, icon: <Sparkles /> })), [models])
  return (
    <ModelSelector
      models={options}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      searchable
      variant="ghost"
      size="sm"
      className="min-w-0 max-w-[min(16rem,45vw)] rounded-full text-muted-foreground"
      contentClassName="terminal-ai-glass-popover"
    />
  )
}
