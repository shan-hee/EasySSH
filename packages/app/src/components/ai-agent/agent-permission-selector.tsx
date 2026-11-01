import { Shield, ShieldAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { modelSelectorTriggerVariants } from "@/components/assistant-ui/elements/model-selector"
import type { PermissionMode } from "@/lib/ai-agent-types"
import { cn } from "@/lib/utils"

const modes = [
  { value: "readonly", label: "permissionModeReadonly", description: "permissionModeReadonlyDesc" },
  { value: "balanced", label: "permissionModeBalanced", description: "permissionModeBalancedDesc" },
  { value: "privileged", label: "permissionModePrivileged", description: "permissionModePrivilegedDesc" },
] as const

/** 全部权限不再逐项确认，选项和触发器都提示外部内容中的指令可能被执行。 */
export function AgentPermissionSelector({ value, onValueChange, disabled, className }: {
  value: PermissionMode
  onValueChange: (value: PermissionMode) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation("aiAssistant")
  const current = modes.find((mode) => mode.value === value) ?? modes[1]
  const privileged = value === "privileged"
  const Icon = privileged ? ShieldAlert : Shield
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as PermissionMode)} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className={cn(modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }), "rounded-full text-muted-foreground", className)}
        title={privileged ? `${t(current.description)}\n${t("permissionModePrivilegedRisk")}` : t(current.description)}
      >
        <Icon className={cn("size-3.5 shrink-0", privileged && "text-amber-600 dark:text-amber-400")} />
        <SelectValue>{t(current.label)}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        sideOffset={6}
        className="terminal-ai-glass-popover w-auto rounded-xl data-[side=bottom]:translate-y-0 data-[side=left]:translate-x-0 data-[side=right]:translate-x-0 data-[side=top]:translate-y-0"
      >
        {modes.map((mode) => (
          <SelectItem
            key={mode.value}
            value={mode.value}
            textValue={t(mode.label)}
            className="max-w-80 items-start rounded-lg py-2 pl-3 pr-9 [&>span:first-child]:right-3 [&>span:first-child]:top-2.5"
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t(mode.label)}</span>
              <span className="text-xs whitespace-normal text-muted-foreground">{t(mode.description)}</span>
              {mode.value === "privileged" && (
                <span className="text-xs whitespace-normal text-amber-700 dark:text-amber-400">{t("permissionModePrivilegedRisk")}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
