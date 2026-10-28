import { useEffect, useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"
import { CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { toast } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { listAISessions, type SessionListItem } from "@/lib/api/ai-agent"

const PAGE_SIZE = 30

export function AISessionSearch({ open, onOpenChange, onSelect, listSessions = listAISessions }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void | Promise<void>
  listSessions?: typeof listAISessions
}) {
  const { t, i18n } = useTranslation("aiAssistant")
  const { t: tCommon } = useTranslation("common")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<SessionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    const timer = window.setTimeout(async () => {
      try {
        const result = await listSessions({ q: query.trim(), page, limit: PAGE_SIZE })
        if (cancelled) return
        setItems((current) => page === 1 ? result.items : [
          ...current,
          ...result.items.filter((item) => !current.some((existing) => existing.id === item.id)),
        ])
        setTotal(result.total)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 260)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, query, page, retry, listSessions])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t("searchPlaceholder")} shouldFilter={false} dismissOnEscape>
      <CommandInput
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        value={query}
        onValueChange={(value) => { setQuery(value); setPage(1); setItems([]); setTotal(0); setLoading(true) }}
      />
      <CommandList className="max-h-[min(28rem,65vh)] p-2" aria-busy={loading || selecting}>
        {items.map((item) => (
          <CommandItem
            key={item.id}
            value={item.id}
            disabled={selecting}
            onSelect={() => {
              setSelecting(true)
              void Promise.resolve().then(() => onSelect(item.id)).then(() => onOpenChange(false)).catch(() => toast.error(t("sessionOpenFailed"))).finally(() => setSelecting(false))
            }}
            className="items-start gap-3 rounded-lg"
          >
            <MessageSquare className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium"><SearchHighlight text={item.title} query={query} /></p>
              <p className="my-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
                {item.preview ? <SearchHighlight text={item.preview} query={query} /> : t("sessionPreviewEmpty")}
              </p>
              <time dateTime={item.updated_at} className="text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString(i18n.language)}</time>
            </div>
          </CommandItem>
        ))}
        {loading && <div role="status" className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loading")}</div>}
        {failed && <div role="alert" className="p-4 text-center text-sm"><p>{t("sessionListLoadFailed")}</p><Button variant="ghost" size="sm" onClick={() => setRetry((n) => n + 1)}>{tCommon("retry")}</Button></div>}
        {!loading && !failed && items.length === 0 && <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t(query.trim() ? "sessionSearchEmpty" : "sessionListEmpty")}</p>}
        {!loading && !failed && items.length < total && <CommandItem value="load-more" onSelect={() => setPage((n) => n + 1)} className="justify-center">{t("loadMoreSessions")}</CommandItem>}
      </CommandList>
    </CommandDialog>
  )
}

function SearchHighlight({ text, query }: { text: string; query: string }) {
  const keyword = query.trim()
  if (!keyword) return <>{text}</>
  const pattern = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  return <>{text.split(pattern).map((part, index) => index % 2
    ? <mark key={index} className="rounded-sm bg-primary/15 text-inherit">{part}</mark>
    : part)}</>
}
