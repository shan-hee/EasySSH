import { useTranslation } from "react-i18next"
import { Checkbox } from "@/components/ui/checkbox"
import { GrantPermissionFields } from "@/components/sharing/grant-permissions"
import { tokenActions, type TokenPermissions } from "@/lib/token-authorization"
import type { Action } from "@/lib/api/grants"

// Tokens name terminal access as command execution, which is what MCP exposes.
export function useActionLabel() {
  const { t } = useTranslation("automation")
  const { t: sharing } = useTranslation("sharing")
  return (action: Action) => action === "terminal.connect" ? t("authorization.commandPermission") : sharing(`actions.${action}`)
}

export function TokenPermissionActions({ value, onChange, disabled }: {
  value: TokenPermissions
  onChange: (value: TokenPermissions) => void
  disabled: boolean
}) {
  const { t } = useTranslation("automation")
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="sr-only">{t("authorization.permissions")}</legend>
    <GrantPermissionFields value={value.actions} available={tokenActions} terminalLabel={t("authorization.commandPermission")} disabled={disabled}
      onChange={actions => onChange({ ...value, actions, scripts: actions.includes("scripts.execute") ? value.scripts : [] })} />
    <label className="flex items-center gap-2 border-t pt-3 text-sm">
      <Checkbox disabled={disabled} checked={value.allow_interactive} onCheckedChange={checked => onChange({ ...value, allow_interactive: checked === true })} />
      {t("authorization.allowInteractive")}
    </label>
    <p className="text-xs text-muted-foreground">{t("authorization.interactiveHelp")}</p>
  </fieldset>
}
