import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { ScriptParameterRules } from "./script-parameter-rules"
import type { Action, GrantInput } from "@/lib/api/grants"
import { groupLevel, levelsOf, permissionGroups, withGroupLevel, type PermissionGroup } from "@/lib/grant-permissions"
import type { Script } from "@/lib/script-types"
import { cn } from "@/lib/utils"

type ApprovedScript = NonNullable<GrantInput["resources"][number]["scripts"]>[number]

/**
 * Grant permissions as on/off switches and cumulative levels. Shared by access
 * sharing and MCP tokens, which both store grant resources.
 */
export function GrantPermissionFields({ value, available, terminalLabel, disabled, onChange }: {
  value: Action[]
  /** Hides groups the caller cannot grant, such as AI for tokens. */
  available?: readonly Action[]
  terminalLabel?: string
  disabled: boolean
  onChange: (actions: Action[]) => void
}) {
  const { t } = useTranslation("sharing")
  const groups = permissionGroups.filter(group => !available || levelsOf(group).every(level => level.every(action => available.includes(action))))
  const label = (group: PermissionGroup) => group.id === "terminal" && terminalLabel ? terminalLabel : t(`permissionGroups.${group.id}`)
  return <div className="space-y-3">
    <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {groups.filter(group => levelsOf(group).length === 1).map(group => <label key={group.id} className="flex items-center justify-between gap-3 text-sm">
        {label(group)}
        <Switch checked={groupLevel(group, value) !== 0} disabled={disabled} onCheckedChange={checked => onChange(withGroupLevel(group, value, checked ? 1 : 0))} />
      </label>)}
    </div>
    {groups.filter(group => levelsOf(group).length > 1).map(group => {
      const level = groupLevel(group, value)
      return <div key={group.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span>{label(group)}</span>
        <div role="radiogroup" aria-label={label(group)} className="inline-flex flex-wrap items-center gap-0.5 rounded-md border p-0.5">
          {[0, ...levelsOf(group).map((_, index) => index + 1)].map(item => <button key={item} type="button" role="radio" aria-checked={level === item} disabled={disabled}
            className={cn("rounded px-2.5 py-1 text-xs transition-colors", level === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            onClick={() => onChange(withGroupLevel(group, value, item))}>
            {item === 0 ? t("permissionLevels.none") : t(`permissionLevels.${group.id}.${item}`)}
          </button>)}
          {/* Combinations saved before levels existed stay untouched until changed. */}
          {level === -1 && <span className="px-2 py-1 text-xs text-amber-700 dark:text-amber-400">{t("permissionLevels.custom")}</span>}
        </div>
      </div>
    })}
  </div>
}

export function ApprovedScriptsField({ value, scripts, disabled, onChange }: {
  value: ApprovedScript[]
  scripts: Script[]
  disabled: boolean
  onChange: (value: ApprovedScript[]) => void
}) {
  const { t } = useTranslation("sharing")
  const id = useId()
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border p-3" aria-labelledby={id}>
    <p id={id} className="text-sm font-medium">{t("approvedScripts")}</p>
    <div className="max-h-44 space-y-2 overflow-y-auto">
      {scripts.map(script => <label key={script.id} className="flex items-center gap-2 text-sm">
        <Checkbox disabled={disabled} checked={value.some(item => item.script_id === script.id)} onCheckedChange={checked => onChange(checked === true
          ? [...value, { script_id: script.id, version: script.version, parameters: {} }]
          : value.filter(item => item.script_id !== script.id))} />
        <span className="truncate" title={script.description}>{script.name}</span>
      </label>)}
      {!scripts.length && <p className="text-sm text-muted-foreground">{t("noScripts")}</p>}
    </div>
    {value.map(allowed => {
      const script = scripts.find(item => item.id === allowed.script_id)
      return <div key={allowed.script_id} className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{script?.name ?? allowed.script_id}</span>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter(item => item.script_id !== allowed.script_id))}>{t("forget")}</Button>
        </div>
        {script?.version !== allowed.version && <div className="space-y-2 text-sm text-destructive">
          <p>{t("scriptChanged")}</p>
          {script && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(value.map(item => item.script_id === script.id ? { ...item, version: script.version } : item))}>{t("updateScriptVersion")}</Button>}
        </div>}
        <details>
          <summary className="cursor-pointer text-sm">{t("scriptParameters")}</summary>
          <div className="mt-2"><ScriptParameterRules value={allowed.parameters ?? {}} onChange={parameters => onChange(value.map(item => item.script_id === allowed.script_id ? { ...item, parameters } : item))} /></div>
        </details>
      </div>
    })}
    <p className="text-xs text-muted-foreground">{t("scriptVersions")}</p>
  </fieldset>
}
