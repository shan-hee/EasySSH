import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ChevronDown,
  Clock,
  Eye,
  KeyRound,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const formatTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function isExpiringSoon(token: AccessToken): boolean {
  if (!token.active) return false
  const diff = new Date(token.expires_at).getTime() - Date.now()
  return diff > 0 && diff <= SEVEN_DAYS_MS
}

export function TokenTable({
  tokens,
  onViewPermissions,
  onEdit,
  onShowToken,
}: {
  tokens: AccessToken[]
  onViewPermissions: (token: AccessToken) => void
  onEdit: (token: AccessToken) => void
  onShowToken: (token: AccessToken, value?: string) => void
}) {
  const { t } = useTranslation("automation")
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [showInactive, setShowInactive] = useState(false)

  const { activeTokens, inactiveTokens } = useMemo(() => {
    const active: AccessToken[] = []
    const inactive: AccessToken[] = []
    for (const token of tokens) {
      if (token.active) active.push(token)
      else inactive.push(token)
    }
    return { activeTokens: active, inactiveTokens: inactive }
  }, [tokens])

  const revoke = async (token: AccessToken) => {
    if (
      !(await confirm({
        title: t("revokeTitle", { name: token.name }),
        description: t("revokeDescription"),
        confirmText: t("revoke"),
        variant: "destructive",
      }))
    ) {
      return
    }
    try {
      await automationApi.revokeToken(token.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })
    } catch (error) {
      toast.error(getErrorMessage(error, t("revokeFailed")))
    }
  }

  const rotate = async (token: AccessToken) => {
    if (
      !(await confirm({
        title: t("rotateTitle", { name: token.name }),
        description: t("rotateDescription"),
        confirmText: t("rotate"),
      }))
    ) {
      return
    }
    try {
      const { token: value } = await automationApi.rotateToken(token.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation.tokens })
      onShowToken(token, value)
    } catch (error) {
      toast.error(getErrorMessage(error, t("rotateFailed")))
    }
  }

  const renderCard = (token: AccessToken) => {
    const expiring = isExpiringSoon(token)
    return (
      <article
        key={token.id}
        className={cn(
          "group flex flex-col justify-between gap-4 rounded-xl border bg-card p-4 transition-all hover:border-foreground/20",
          !token.active && "bg-muted/20 opacity-80",
        )}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  token.active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <KeyRound className="size-4" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground" title={token.name}>
                  {token.name}
                </h3>
                {token.grant_name && token.grant_name !== token.name ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={token.grant_name}>
                    {token.grant_name}
                  </p>
                ) : null}
              </div>
            </div>

            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                token.active
                  ? expiring
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  token.active
                    ? expiring
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                    : "bg-muted-foreground/60",
                )}
              />
              {token.active
                ? expiring
                  ? t("expiringSoon")
                  : t("status.active")
                : token.revoked_at
                  ? t("status.revoked")
                  : t("status.inactive")}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/35 px-3 py-2 text-xs">
            <div className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{t("columns.lastUsed")}</dt>
              <dd className="mt-0.5 truncate font-medium tabular-nums text-foreground/90">
                {token.last_used_at ? formatTime(token.last_used_at) : t("never")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="size-3" />
                <span>{t("columns.expires")}</span>
              </dt>
              <dd
                className={cn(
                  "mt-0.5 truncate font-medium tabular-nums",
                  expiring ? "text-amber-700 dark:text-amber-300" : "text-foreground/90",
                )}
              >
                {formatTime(token.expires_at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {token.active ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => onShowToken(token)}
              >
                <Eye className="size-3.5" />
                {t("showToken")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => (token.active && token.editable ? onEdit(token) : onViewPermissions(token))}
            >
              {token.active && token.editable ? <Pencil className="size-3.5" /> : <Shield className="size-3.5" />}
              {token.active && token.editable ? t("editPermissions") : t("viewPermissions")}
            </Button>
          </div>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                aria-label={t("columns.actions")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {token.active ? (
                <DropdownMenuItem onSelect={() => onShowToken(token)}>
                  <Eye className="size-3.5" />
                  {t("showToken")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onViewPermissions(token)}>
                <Shield className="size-3.5" />
                {t("viewPermissions")}
              </DropdownMenuItem>
              {token.active && token.editable ? (
                <DropdownMenuItem onSelect={() => onEdit(token)}>
                  <Pencil className="size-3.5" />
                  {t("editPermissions")}
                </DropdownMenuItem>
              ) : null}
              {token.active ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void rotate(token)}>
                    <RefreshCw className="size-3.5" />
                    {t("rotate")}
                  </DropdownMenuItem>
                </>
              ) : null}
              {!token.revoked_at ? (
                <DropdownMenuItem variant="destructive" onSelect={() => void revoke(token)}>
                  <Trash2 className="size-3.5" />
                  {t("revoke")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>
    )
  }

  return (
    <div className="space-y-4">
      {activeTokens.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeTokens.map(renderCard)}
        </div>
      ) : null}

      {inactiveTokens.length > 0 ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowInactive((open) => !open)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !showInactive && "-rotate-90")} />
            <span>{t("inactiveTokensTitle", { count: inactiveTokens.length })}</span>
          </button>
          {(showInactive || activeTokens.length === 0) ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {inactiveTokens.map(renderCard)}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmDialog}
    </div>
  )
}
