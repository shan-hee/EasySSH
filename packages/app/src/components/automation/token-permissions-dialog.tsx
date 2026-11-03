import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { useActionLabel } from "./token-permission-fields"
import type { AccessToken } from "@/lib/api/automation"
import { grantsApi, reviewGrantTarget, type AccessResource } from "@/lib/api/grants"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import { PageLoading } from "@/components/page-loading"

export function TokenPermissionsDialog({ token, onClose }: { token: AccessToken | null; onClose: () => void }) {
  return <Dialog open={!!token} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
      {token && <TokenPermissions token={token} />}
    </DialogContent>
  </Dialog>
}

function TokenPermissions({ token }: { token: AccessToken }) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [busy, setBusy] = useState(false)
  const detail = useQuery({ queryKey: queryKeys.automation.grant(token.grant_id), queryFn: () => grantsApi.detail(token.grant_id), staleTime: 0 })
  const grant = detail.data
  // A paused resource changed its connection target after the grant; the owner
  // re-approves the current target before the token may reach it again.
  const review = async (resource: AccessResource) => {
    setBusy(true)
    try {
      const target = await reviewGrantTarget(resource)
      if (!await confirm({ title: t("reviewTarget"), description: t("confirmTarget", { target: target.summary.split("\n").join("; ") }) })) return
      await grantsApi.confirm(token.grant_id, resource.id, target.revision)
      await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })])
    } catch (error) {
      toast.error(getErrorMessage(error, t("operationFailed")))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <DialogHeader className="shrink-0 border-b p-6 pr-12">
      <DialogTitle className="truncate">{token.name}</DialogTitle>
      <DialogDescription>{token.editable ? t("permissionsHelp") : t("permissionsHelpShared", { name: token.grant_name })}</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {detail.isPending && <PageLoading className="min-h-0 py-10" />}
      {detail.isError && <p role="alert" className="text-sm text-destructive">{t("loadFailed")}</p>}
      {grant?.resources.map(resource => {
        const scripts = grant.scripts.filter(script => script.server_id === resource.id).length
        return <div key={resource.id} className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{resource.name}</p>
              <p className="truncate text-xs text-muted-foreground">{resource.username}@{resource.host}:{resource.port}</p>
            </div>
            {resource.paused && <Button size="sm" variant="outline" disabled={busy || !!grant.grant.revoked_at} onClick={() => void review(resource)}>{t("reviewTarget")}</Button>}
          </div>
          <div className="flex flex-wrap gap-1">
            {resource.actions.map(action => <Badge key={action} variant="secondary" className="font-normal">{actionLabel(action)}</Badge>)}
            {scripts > 0 && <Badge variant="outline" className="font-normal">{t("scriptCount", { count: scripts })}</Badge>}
          </div>
        </div>
      })}
    </div>
    {confirmDialog}
  </>
}
