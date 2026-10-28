import { useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import { Loader2, Plus, Search } from "lucide-react"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { AISessionSearch } from "./ai-session-search"
import type { listAISessions } from "@/lib/api/ai-agent"
import { AISessionHistoryList } from "./ai-session-history-list"
import { useAISidebarNavigation } from "./ai-sidebar-host"
import type { AISessionHistoryState } from "@/hooks/use-ai-session-history"

export function AISessionSidebar({
  history,
  activeSessionId,
  onCreate,
  onRestore,
  onDelete,
  creating,
  createDisabled,
  configuration,
  listSessions,
  t,
}: {
  history: AISessionHistoryState
  activeSessionId: string | null
  onCreate: () => void | Promise<void>
  onRestore: (id: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  creating: boolean
  createDisabled: boolean
  configuration: ReactNode
  listSessions?: typeof listAISessions
  t: TFunction<"aiAssistant">
}) {
  const navigation = useAISidebarNavigation()
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <section aria-label={t("pageTitle")} className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <SidebarMenuButton
        tooltip={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        disabled={Boolean(history.renamingId) || Boolean(history.actionLoadingId)}
        onClick={() => setSearchOpen(true)}
        className="h-9 shrink-0 text-muted-foreground"
      >
        <Search className="size-4" />
        <span>{t("searchPlaceholder")}</span>
      </SidebarMenuButton>
      {searchOpen && <AISessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelect={onRestore} listSessions={listSessions} />}
      <div className="flex w-full shrink-0 items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-start">
        <SidebarMenuButton
          tooltip={t("newSession")}
          aria-label={t("newSession")}
          disabled={createDisabled}
          onClick={() => void onCreate()}
          className="h-9 flex-1 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center"
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          <span className="group-data-[collapsible=icon]:hidden">{t("newSession")}</span>
        </SidebarMenuButton>
        {configuration}
      </div>
      {navigation}
      <AISessionHistoryList
        activeSessionId={activeSessionId}
        history={history}
        onDelete={onDelete}
        onRestore={onRestore}
        t={t}
        compact
        className="-mx-2 flex-1 px-2 group-data-[collapsible=icon]:hidden"
      />
    </section>
  )
}
