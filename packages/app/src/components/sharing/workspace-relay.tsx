import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AccessResource } from "@/lib/api/grants"
import { transferJobsApi } from "@/lib/api/transfer-jobs"
import { openWorkspaceTask } from "@/lib/workspace-task-navigation"

export function WorkspaceRelay({
  resources,
}: {
  resources: AccessResource[]
  desktop?: boolean
}) {
  const { t } = useTranslation("sharing")
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false)
  const [source, setSource] = useState(""),
    [target, setTarget] = useState("")
  const [sourcePath, setSourcePath] = useState(""),
    [targetPath, setTargetPath] = useState("")
  const [error, setError] = useState(""),
    [task, setTask] = useState("")
  const sources = resources.filter(
    (r) => !r.paused && r.actions.includes("files.download"),
  )
  const targets = resources.filter(
    (r) => !r.paused && r.actions.includes("files.upload"),
  )
  if (!sources.some((s) => targets.some((d) => d.id !== s.id))) return null
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("relay")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("relay")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("relayHint")}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              setError("")
              void transferJobsApi
                .createRelay({
                  sourceServerId: source,
                  targetServerId: target,
                  sourcePath,
                  targetPath,
                })
                .then((job) => setTask(job.task_run_id || ""))
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false))
            }}
          >
            <label className="block text-sm">
              {t("sourceServer")}
              <select
                required
                className="block w-full rounded border bg-background p-2"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  if (e.target.value === target) setTarget("")
                }}
              >
                <option value="">{t("selectValue")}</option>
                {sources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Input
              required
              aria-label={t("sourcePath")}
              placeholder={t("sourcePath")}
              pattern="/.*"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
            />
            <label className="block text-sm">
              {t("targetServer")}
              <select
                required
                className="block w-full rounded border bg-background p-2"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{t("selectValue")}</option>
                {targets
                  .filter((r) => r.id !== source)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <Input
              required
              aria-label={t("targetPath")}
              placeholder={t("targetPath")}
              pattern="/.*"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
            />
            <Button disabled={busy} type="submit">
              {t("startRelay")}
            </Button>
          </form>
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
