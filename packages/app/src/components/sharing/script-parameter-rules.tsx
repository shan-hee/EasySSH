import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import type { components } from "@/generated/openapi"

type Rules = Record<string, components["schemas"]["GrantParameterRule"]>
export function ScriptParameterRules({
  value,
  onChange,
}: {
  value: Rules
  onChange: (rules: Rules) => void
}) {
  const { t } = useTranslation("sharing")
  const [name, setName] = useState("")
  return (
    <div className="space-y-2 rounded border p-2 text-xs">
      <p>{t("parameterRulesHint")}</p>
      {Object.entries(value).map(([key, rule]) => (
        <div key={key} className="grid gap-2 border-b pb-2 sm:grid-cols-2">
          <strong>{key}</strong>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={rule.required}
              onCheckedChange={(checked) =>
                onChange({
                  ...value,
                  [key]: { ...rule, required: checked === true },
                })
              }
            />{" "}
            {t("required")}
          </label>
          <label>
            {t("maxBytes")}
            <Input
              required
              type="number"
              min={1}
              max={4096}
              value={rule.max_bytes}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: { ...rule, max_bytes: Number(e.target.value) },
                })
              }
            />
          </label>
          <label>
            {t("allowedValues")}
            <Textarea
              value={rule.values?.join("\n") ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: {
                    ...rule,
                    values: e.target.value
                      ? e.target.value.split("\n")
                      : undefined,
                  },
                })
              }
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = { ...value }
              delete next[key]
              onChange(next)
            }}
          >
            {t("removeParameter")}
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          aria-label={t("parameterName")}
          placeholder={t("parameterName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name in value}
          onClick={() => {
            onChange({ ...value, [name]: { required: true, max_bytes: 256 } })
            setName("")
          }}
        >
          {t("addParameter")}
        </Button>
      </div>
    </div>
  )
}
