import { useRef, type ReactNode } from "react"
import type { TFunction } from "i18next"
import { Loader2, Plus, Search } from "lucide-react"
import { ThreadListSearch } from "@/components/assistant-ui/elements/thread-list-search"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"
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
  t: TFunction<"aiAssistant">
}) {
  const { setOpen } = useSidebar()
  const navigation = useAISidebarNavigation()
  const searchRef = useRef<HTMLInputElement>(null)
  return (
    <section aria-label={t("pageTitle")} className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <div className="shrink-0 group-data-[collapsible=icon]:hidden">
        <ThreadListSearch
          ref={searchRef}
          value={history.search}
          onValueChange={history.setSearch}
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          disabled={Boolean(history.renamingId) || Boolean(history.actionLoadingId)}
          className="bg-sidebar shadow-none"
        />
      </div>
      <TooltipIconButton
        tooltip={t("searchPlaceholder")}
        className="hidden size-8 shrink-0 group-data-[collapsible=icon]:inline-flex"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => searchRef.current?.focus())
        }}
      >
        <Search className="size-4" />
      </TooltipIconButton>
      <div className="flex w-full shrink-0 items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-start">
        <SidebarMenuButton
          tooltip={t("newSession")}
          aria-label={t("newSession")}
          disabled={createDisabled}
          onClick={() => void onCreate()}
          className="h-9 flex-1 border border-sidebar-border group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center"
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
        className="flex-1 group-data-[collapsible=icon]:hidden"
      />
    </section>
  )
}
