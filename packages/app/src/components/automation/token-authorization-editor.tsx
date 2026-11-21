import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Check,
  Eye,
  FileCode2,
  FolderPen,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ServerScopePicker } from "@/components/servers/server-scope-picker"
import { TokenPermissionActions, useActionLabel } from "./token-permission-fields"
import { ApprovedScriptsField } from "@/components/sharing/grant-permissions"
import {
  presetPermissions,
  tokenPresets,
  tokenResourceLimit,
  type TokenAuthorizationDraft,
  type TokenPermissions,
  type TokenPreset,
} from "@/lib/token-authorization"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/server-types"
import type { Script } from "@/lib/script-types"

const presets = (Object.keys(tokenPresets) as TokenPreset[]).filter((preset) => preset !== "custom")

const PRESET_VISUALS: Record<Exclude<TokenPreset, "custom">, { icon: typeof Eye; tone: string }> = {
  inspect: { icon: Eye, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  files: { icon: FolderPen, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  scripts: { icon: FileCode2, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  operations: { icon: Terminal, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
}

export function TokenAuthorizationEditor({
  value,
  servers,
  scripts,
  disabled,
  loading,
  onChange,
}: {
  value: TokenAuthorizationDraft
  servers: Server[]
  scripts: Script[]
  disabled: boolean
  loading: boolean
  onChange: (draft: TokenAuthorizationDraft) => void
}) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  const id = useId()
  const [customizing, setCustomizing] = useState(false)
  const { actions } = value.permissions
  const changePermissions = (permissions: TokenPermissions, preset: TokenPreset = "custom") =>
    onChange({ ...value, preset, permissions })

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5">
      <legend className="sr-only">{t("authorization.title")}</legend>

      <section className="space-y-2.5" aria-labelledby={`${id}-purpose`}>
        <h3 id={`${id}-purpose`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("authorization.purposeTitle")}
        </h3>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {presets.map((preset) => {
            const visual = PRESET_VISUALS[preset as Exclude<TokenPreset, "custom">]
            const Icon = visual.icon
            const selected = value.preset === preset
            return (
              <label
                key={preset}
                className={cn(
                  "relative flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all",
                  selected
                    ? "border-primary bg-primary/[0.04] ring-1 ring-primary/15"
                    : "bg-card hover:border-foreground/20 hover:bg-muted/30",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-purpose`}
                  className="sr-only"
                  value={preset}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => changePermissions(presetPermissions(preset), preset)}
                />
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", visual.tone)}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 pr-4">
                  <span className="block text-sm font-medium text-foreground">
                    {t(`authorization.presets.${preset}.name`)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {t(`authorization.presets.${preset}.description`)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30 bg-transparent",
                  )}
                >
                  {selected ? <Check className="size-2.5 stroke-[3]" /> : null}
                </span>
              </label>
            )
          })}
        </div>

        {/* 生效权限摘要条 + 展开细粒度勾选 */}
        <div className="rounded-xl border bg-muted/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label={t("authorization.permissions")}>
              {actions.map((action) => (
                <Badge key={action} variant="secondary" className="rounded-md bg-background/80 font-normal">
                  {actionLabel(action)}
                </Badge>
              ))}
              {!actions.length && (
                <span className="text-xs text-muted-foreground">{t("authorization.noPermissions")}</span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={customizing}
              onClick={() => setCustomizing((open) => !open)}
            >
              <SlidersHorizontal className="size-3" />
              {customizing ? t("authorization.doneCustomizing") : t("authorization.customize")}
            </Button>
          </div>
          {customizing && (
            <div className="mt-3 border-t pt-3">
              <TokenPermissionActions
                value={value.permissions}
                disabled={disabled}
                onChange={(permissions) => changePermissions(permissions)}
              />
            </div>
          )}
        </div>

        {actions.includes("scripts.execute") && (
          <ApprovedScriptsField
            value={value.permissions.scripts}
            scripts={scripts}
            disabled={disabled}
            onChange={(allowed) => changePermissions({ ...value.permissions, scripts: allowed }, value.preset)}
          />
        )}
      </section>

      <section className="space-y-2.5" aria-labelledby={`${id}-scope`}>
        <h3 id={`${id}-scope`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("authorization.scopeTitle")}
        </h3>
        <ServerScopePicker
          servers={servers}
          value={value.serverIds}
          loading={loading}
          disabled={disabled}
          limit={tokenResourceLimit}
          onChange={(serverIds) => onChange({ ...value, serverIds })}
        />
      </section>

      {(actions.includes("terminal.connect") || actions.includes("scripts.execute")) && (
        <div className="space-y-2">
          {actions.includes("terminal.connect") && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p className="leading-5">{t("commandWarning")}</p>
            </div>
          )}
          {actions.includes("scripts.execute") && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p className="leading-5">{t("authorization.scriptEffects")}</p>
            </div>
          )}
        </div>
      )}
    </fieldset>
  )
}
