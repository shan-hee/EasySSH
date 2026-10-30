import { useTranslation } from "react-i18next"

export function ExecutionResult({ raw }: { raw?: string }) {
  const { t } = useTranslation("taskCenter")
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return (
      <pre className="whitespace-pre-wrap break-words p-3 text-xs">{raw}</pre>
    )
  }
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  const details =
    root.details && typeof root.details === "object"
      ? (root.details as Record<string, unknown>)
      : root
  const paths = [
    "success_paths",
    "failed_paths",
    "unresolved_paths",
    "effects",
  ] as const
  const structured =
    paths.some((k) => Array.isArray(details[k])) || !!details.effects
  return (
    <div className="space-y-3 text-sm">
      {structured && (
        <p className="text-muted-foreground">{t("partialEffectsHint")}</p>
      )}
      {paths.map((k) =>
        Array.isArray(details[k]) && (details[k] as unknown[]).length > 0 ? (
          <details key={k} open={k !== "effects"}>
            <summary className="cursor-pointer">
              {t(k)} · {(details[k] as unknown[]).length}
            </summary>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
              {JSON.stringify(details[k], null, 2)}
            </pre>
          </details>
        ) : null,
      )}
      {details.effects && !Array.isArray(details.effects) ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
          {JSON.stringify(details.effects, null, 2)}
        </pre>
      ) : null}
      <details open={!structured}>
        <summary className="cursor-pointer">{t("resultTitle")}</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      </details>
    </div>
  )
}
