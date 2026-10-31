import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"

const formatTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function TokenTable({ tokens, onViewPermissions }: {
  tokens: AccessToken[]
  onViewPermissions: (token: AccessToken) => void
}) {
  const { t } = useTranslation("automation")
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const revoke = async (token: AccessToken) => {
    if (!await confirm({ title: t("revokeTitle", { name: token.name }), description: t("revokeDescription"), confirmText: t("revoke"), variant: "destructive" })) return
    try {
      await automationApi.revokeToken(token.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })
    } catch (error) {
      toast.error(getErrorMessage(error, t("revokeFailed")))
    }
  }

  return <div className="overflow-hidden rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.name")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
          <TableHead className="hidden md:table-cell">{t("columns.lastUsed")}</TableHead>
          <TableHead className="hidden sm:table-cell">{t("columns.expires")}</TableHead>
          <TableHead className="w-14"><span className="sr-only">{t("columns.actions")}</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tokens.map(token => <TableRow key={token.id} className={token.active ? undefined : "text-muted-foreground"}>
          <TableCell className="max-w-72 py-3">
            <p className="truncate font-medium" title={token.name}>{token.name}</p>
            {token.grant_name !== token.name && <p className="truncate text-xs text-muted-foreground" title={token.grant_name}>{token.grant_name}</p>}
          </TableCell>
          <TableCell className="py-3">
            <Badge variant={token.active ? "secondary" : "outline"} className="font-normal">
              {t(token.active ? "status.active" : token.revoked_at ? "status.revoked" : "status.inactive")}
            </Badge>
          </TableCell>
          <TableCell className="hidden py-3 md:table-cell">{token.last_used_at ? formatTime(token.last_used_at) : t("never")}</TableCell>
          <TableCell className="hidden py-3 sm:table-cell">{formatTime(token.expires_at)}</TableCell>
          <TableCell className="py-3 text-right">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("columns.actions")}><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onViewPermissions(token)}>{t("viewPermissions")}</DropdownMenuItem>
                {!token.revoked_at && <DropdownMenuItem variant="destructive" onSelect={() => void revoke(token)}>{t("revoke")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    {confirmDialog}
  </div>
}
