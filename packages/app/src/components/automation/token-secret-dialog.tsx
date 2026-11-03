import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { TokenSecretView } from "./create-token-dialog"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { queryKeys } from "@/lib/query-keys"

// value is set right after a rotation; otherwise the token is fetched on open.
export type ShownToken = { token: AccessToken; value?: string }

export function TokenSecretDialog({ shown, onClose }: { shown: ShownToken | null; onClose: () => void }) {
  return <Dialog open={!!shown} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      {shown && <TokenSecret {...shown} />}
    </DialogContent>
  </Dialog>
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

  return <>
    <DialogHeader className="shrink-0 border-b p-6 pr-12">
      <DialogTitle className="truncate">{token.name}</DialogTitle>
      <DialogDescription>{t("secret.description")}</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {secret
        ? <TokenSecretView token={secret} />
        : !token.viewable
          ? <p className="text-sm text-muted-foreground">{t("secret.notStored")}</p>
          : reveal.isError
            ? <p role="alert" className="text-sm text-destructive">{t("secret.loadFailed")}</p>
            : <PageLoading className="min-h-0 py-10" />}
    </div>
  </>
}
