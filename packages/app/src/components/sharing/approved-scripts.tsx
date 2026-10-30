import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiFetch } from "@/lib/api-client"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"
import type { components } from "@/generated/openapi"

type Script = components["schemas"]["AvailableScript"]
export function ApprovedScripts({ serverId }: { serverId: string }) {
  const { t } = useTranslation("sharing")
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Script | null>(null)
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [task, setTask] = useState("")
  const query = useQuery({
    queryKey: ["approvedScripts", serverId],
    enabled: open,
    queryFn: async () => {
      const items: Script[] = []
      let after = ""
      do {
        const page = await apiFetch<components["schemas"]["ScriptCatalogPage"]>(
          `/scripts/available?${new URLSearchParams({ server_id: serverId, after_id: after, limit: "100" })}`,
        )
        items.push(...page.items)
        if (!page.has_more) break
        if (!page.next_after_id || page.next_after_id === after)
          throw new Error("Invalid script cursor")
        after = page.next_after_id
      } while (true)
      return items
    },
  })
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("approvedScripts")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("approvedScripts")}</DialogTitle>
          </DialogHeader>
          {(error || query.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || query.error?.message}
            </p>
          )}
          <Button
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("refresh")}
          </Button>
          {query.isPending ? (
            <p>{t("opening")}</p>
          ) : (
            <select
              aria-label={t("approvedScripts")}
              className="rounded border bg-background p-2"
              value={selected?.id ?? ""}
              onChange={(e) => {
                setSelected(
                  query.data?.find((s) => s.id === e.target.value) ?? null,
                )
                setParameters({})
                setTask("")
              }}
            >
              <option value="">{t("selectScript")}</option>
              {query.data?.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {selected && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                setBusy(true)
                setError("")
                void (async () => {
                  for (const [name, rule] of Object.entries(
                    selected.parameters,
                  )) {
                    const value = parameters[name] ?? ""
                    if (new TextEncoder().encode(value).length > rule.max_bytes)
                      throw new Error(
                        t("parameterTooLong", { name, max: rule.max_bytes }),
                      )
                  }
                  const result = await apiFetch<
                    components["schemas"]["ScriptAccepted"]
                  >(`/scripts/${selected.id}/execute`, {
                    method: "POST",
                    body: {
                      server_ids: [serverId],
                      script_version: selected.version,
                      parameters,
                    },
                  })
                  setTask(result.task_id)
                })()
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false))
              }}
            >
              <p className="text-sm text-muted-foreground">
                {selected.description}
              </p>
              {Object.entries(selected.parameters).map(([name, rule]) => (
                <label key={name} className="block space-y-1 text-sm">
                  {name}
                  {rule.required ? " *" : ""}
                  {rule.values?.length ? (
                    <select
                      className="block w-full rounded border bg-background p-2"
                      required={rule.required}
                      value={parameters[name] ?? ""}
                      onChange={(e) =>
                        setParameters({ ...parameters, [name]: e.target.value })
                      }
                    >
                      <option value="">{t("selectValue")}</option>
                      {rule.values.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      required={rule.required}
                      value={parameters[name] ?? ""}
                      onChange={(e) =>
                        setParameters({ ...parameters, [name]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              <Button type="submit" disabled={busy}>
                {t("execute")}
              </Button>
            </form>
          )}
          {task && (
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                openWorkspaceTask(task)
              }}
            >
              {t("viewTask")}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
