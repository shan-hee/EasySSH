import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Pencil, Server as ServerIcon, Shield } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { useActionLabel } from "./token-permission-fields"
import type { AccessToken } from "@/lib/api/automation"
import { grantsApi, reviewGrantTarget, type AccessResource } from "@/lib/api/grants"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import { PageLoading } from "@/components/page-loading"
import { cn } from "@/lib/utils"

export function TokenPermissionsDialog({
  token,
  onClose,
  onEdit,
}: {
  token: AccessToken | null
  onClose: () => void
  onEdit?: (token: AccessToken) => void
}) {
  return (
    <Dialog open={!!token} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {token && (
          <TokenPermissions
            token={token}
            onEdit={
              onEdit && token.active && token.editable
                ? () => {
                    onClose()
                    onEdit(token)
                  }
                : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TokenPermissions({ token, onEdit }: { token: AccessToken; onEdit?: () => void }) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [busy, setBusy] = useState(false)
  const detail = useQuery({
    queryKey: queryKeys.automation.grant(token.grant_id),
    queryFn: () => grantsApi.detail(token.grant_id),
    staleTime: 0,
  })
  const grant = detail.data

  // A paused resource changed its connection target after the grant; the owner
  // re-approves the current target before the token may reach it again.
  const review = async (resource: AccessResource) => {
    setBusy(true)
    try {
      const target = await reviewGrantTarget(resource)
      if (!(await confirm({ title: t("reviewTarget"), description: t("confirmTarget", { target: target.summary.split("\n").join("; ") }) }))) {
        return
      }
      await grantsApi.confirm(token.grant_id, resource.id, target.revision)
      await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })])
    } catch (error) {
      toast.error(getErrorMessage(error, t("operationFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Shield className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="truncate text-base">{token.name}</DialogTitle>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  token.active
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", token.active ? "bg-emerald-500" : "bg-muted-foreground/60")} />
                {t(token.active ? "status.active" : token.revoked_at ? "status.revoked" : "status.inactive")}
              </span>
            </div>
            <DialogDescription className="mt-0.5 text-xs">
              {token.editable ? t("permissionsHelp") : t("permissionsHelpShared", { name: token.grant_name })}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {detail.isPending && <PageLoading className="min-h-0 py-10" />}
        {detail.isError && <p role="alert" className="text-sm text-destructive">{t("loadFailed")}</p>}
        {grant?.resources.map((resource) => {
          const scripts = grant.scripts.filter((script) => script.server_id === resource.id).length
          return (
            <div
              key={resource.id}
              className={cn(
                "space-y-2.5 rounded-xl border bg-muted/20 p-3.5 text-sm",
                resource.paused && "border-amber-500/35 bg-amber-500/[0.05]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background border text-muted-foreground">
                    <ServerIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{resource.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {resource.username}@{resource.host}:{resource.port}
                    </p>
                  </div>
                </div>
                {resource.paused && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 border-amber-500/40 text-xs text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
                    disabled={busy || !!grant.grant.revoked_at}
                    onClick={() => void review(resource)}
                  >
                    <AlertTriangle className="size-3" />
                    {t("reviewTarget")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {resource.actions.map((action) => (
                  <Badge key={action} variant="secondary" className="rounded-md bg-background/85 font-normal">
                    {actionLabel(action)}
                  </Badge>
                ))}
                {scripts > 0 && (
                  <Badge variant="outline" className="rounded-md font-normal">
                    {t("scriptCount", { count: scripts })}
                  </Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {onEdit ? (
        <DialogFooter className="shrink-0 border-t bg-muted/20 px-6 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1.5 size-3.5" />
            {t("editPermissions")}
          </Button>
        </DialogFooter>
      ) : null}

      {confirmDialog}
    </>
  )
}
