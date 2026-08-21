import { Shield, Sparkles } from "lucide-react"

import {
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
} from "@/components/ai-elements/prompt-input"
import type { PermissionMode } from "@/lib/api/ai-agent"
import { cn } from "@/lib/utils"

const triggerClass = "h-5 max-w-28 gap-1 border-0 bg-transparent px-0 text-[11px] text-muted-foreground shadow-none hover:text-foreground focus:ring-0 dark:bg-transparent"

export function AIModelControl({
  className,
  disabled,
  models,
  onChange,
  value,
}: {
  className?: string
  disabled?: boolean
  models: string[]
  onChange: (value: string) => void
  value: string
}) {
  return (
    <PromptInputModelSelect value={value} onValueChange={onChange} disabled={disabled}>
      <PromptInputModelSelectTrigger className={cn(triggerClass, className)} aria-label="Model">
        <Sparkles className="size-3 shrink-0" />
        <PromptInputModelSelectValue />
      </PromptInputModelSelectTrigger>
      <PromptInputModelSelectContent>
        {models.map((model) => (
          <PromptInputModelSelectItem key={model} value={model}>{model}</PromptInputModelSelectItem>
        ))}
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  )
}

export function AIPermissionControl({
  className,
  disabled,
  onChange,
  options,
  value,
}: {
  className?: string
  disabled?: boolean
  onChange: (value: PermissionMode) => void
  options: Array<{ value: PermissionMode; label: string; description: string }>
  value: PermissionMode
}) {
  const active = options.find((option) => option.value === value)
  return (
    <PromptInputModelSelect
      value={value}
      onValueChange={(next) => onChange(next as PermissionMode)}
      disabled={disabled}
    >
      <PromptInputModelSelectTrigger
        className={cn(triggerClass, className)}
        title={active?.description}
        aria-label={active?.description}
      >
        <Shield className="size-3 shrink-0" />
        <PromptInputModelSelectValue />
      </PromptInputModelSelectTrigger>
      <PromptInputModelSelectContent>
        {options.map((option) => (
          <PromptInputModelSelectItem key={option.value} value={option.value}>
            <span className="flex flex-col">
              <span>{option.label}</span>
              <span className="text-[11px] text-muted-foreground">{option.description}</span>
            </span>
          </PromptInputModelSelectItem>
        ))}
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  )
}
