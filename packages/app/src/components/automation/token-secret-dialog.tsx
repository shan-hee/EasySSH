import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { AlertCircle, KeyRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { TokenSecretView } from "./create-token-dialog"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { queryKeys } from "@/lib/query-keys"

// value is set right after a rotation; otherwise the token is fetched on open.
export type ShownToken = { token: AccessToken; value?: string }

export function TokenSecretDialog({ shown, onClose }: { shown: ShownToken | null; onClose: () => void }) {
  return (
    <Dialog open={!!shown} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {shown && <TokenSecret {...shown} />}
      </DialogContent>
    </Dialog>
  )
}

function TokenSecret({ token, value }: ShownToken) {
  const { t } = useTranslation("automation")
  // gcTime 0 drops the secret from the query cache once the dialog closes.
  const reveal = useQuery({
    queryKey: queryKeys.automation.tokenSecret(token.id),
    queryFn: () => automationApi.revealToken(token.id),
    enabled: !value && token.viewable,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const secret = value ?? reveal.data?.token

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="truncate text-base">{token.name}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">{t("secret.description")}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {secret ? (
          <TokenSecretView token={secret} />
        ) : !token.viewable ? (
          <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 px-4 py-3.5 text-xs leading-5 text-muted-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>{t("secret.notStored")}</p>
          </div>
        ) : reveal.isError ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-4 py-3.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>{t("secret.loadFailed")}</p>
          </div>
        ) : (
          <PageLoading className="min-h-0 py-10" />
        )}
      </div>
    </>
  )
}
