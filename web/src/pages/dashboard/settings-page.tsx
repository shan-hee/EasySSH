import { Suspense } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Archive, Bot, Cable, Clock3, Fingerprint, Globe, HardDrive, Mail, Settings, Shield, Users, Workflow } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { cn } from "@/lib/utils"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { settingsSections, type SettingsSectionId } from "@/lib/settings-section-registry"
import { ResourceBoundary } from "@/components/resource-boundary"
import { useIntentPreload } from "@/hooks/use-intent-preload"

interface SettingsItem {
  id: SettingsSectionId
  nameKey: string
  icon: React.ElementType
}

interface SettingsGroup {
  id: string
  nameKey: string
  items: SettingsItem[]
}

const groups: SettingsGroup[] = [
  { id: "general", nameKey: "groupGeneral", items: [
    { id: "basic", nameKey: "itemBasic", icon: Settings },
  ] },
  { id: "identity", nameKey: "groupIdentity", items: [
    { id: "users", nameKey: "itemUsers", icon: Users },
    { id: "authentication", nameKey: "itemAuthentication", icon: Fingerprint },
    { id: "access-control", nameKey: "itemAccessControl", icon: Shield },
  ] },
  { id: "workspace", nameKey: "groupWorkspace", items: [
    { id: "workspace", nameKey: "itemWorkspace", icon: Workflow },
  ] },
  { id: "automation", nameKey: "groupAutomation", items: [
    { id: "scheduled-tasks", nameKey: "itemScheduledTasks", icon: Clock3 },
  ] },
  { id: "network", nameKey: "groupNetwork", items: [
    { id: "network", nameKey: "itemNetworkDeployment", icon: Globe },
    { id: "file-transfer", nameKey: "itemFileTransfer", icon: Cable },
  ] },
  { id: "integrations", nameKey: "groupIntegrations", items: [
    { id: "ai-config", nameKey: "itemAIConfig", icon: Bot },
    { id: "notification-config", nameKey: "itemNotificationConfig", icon: Mail },
  ] },
  { id: "data", nameKey: "groupData", items: [
    { id: "backup", nameKey: "itemBackup", icon: Archive },
  ] },
]

const items = groups.flatMap((group) => group.items)

function NavigationButton({ item, active, onClick }: { item: SettingsItem; active: boolean; onClick: () => void }) {
  const { t } = useTranslation("settingsMain")
  const preloadHandlers = useIntentPreload(() => { void settingsSections[item.id].preload().catch(() => undefined) })
  return (
    <button
      type="button"
      {...preloadHandlers}
      onClick={() => { preloadHandlers.onClick(); onClick() }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{t(item.nameKey)}</span>
    </button>
  )
}

function SettingsContent() {
  const { t } = useTranslation("settingsMain")
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get("section") || "basic"
  const activeSection = items.some((item) => item.id === requestedSection) ? requestedSection : "basic"
  const activeItem = items.find((item) => item.id === activeSection) ?? items[0]
  const activeResource = settingsSections[activeItem.id]
  const ActiveComponent = activeResource.Component
  const ActiveIcon = activeItem.icon

  const selectSection = (section: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("section", section)
    navigate(`${pathname}?${next.toString()}`, { replace: true })
  }

  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <DashboardPageContent className="min-h-0 gap-3 overflow-y-auto lg:flex-row lg:items-start lg:overflow-hidden">
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b pb-2 lg:hidden">
          {items.map((item) => (
            <div key={item.id} className="w-fit shrink-0">
              <NavigationButton item={item} active={item.id === activeSection} onClick={() => selectSection(item.id)} />
            </div>
          ))}
        </div>

        <aside className="hidden w-56 shrink-0 rounded-lg border bg-card p-3 scrollbar-custom lg:block lg:max-h-full lg:overflow-y-auto">
          <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold"><HardDrive className="h-4 w-4" />{t("navigationTitle")}</div>
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.id} className="space-y-1">
                <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(group.nameKey)}</h2>
                {group.items.map((item) => (
                  <NavigationButton key={item.id} item={item} active={item.id === activeSection} onClick={() => selectSection(item.id)} />
                ))}
              </section>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card scrollbar-custom lg:h-full lg:overflow-y-auto">
          <div className="shrink-0 border-b px-4 py-3">
            <h1 className="flex items-center gap-2 text-base font-semibold"><ActiveIcon className="h-4 w-4" />{t(activeItem.nameKey)}</h1>
          </div>
          <ResourceBoundary key={activeSection} onRetry={activeResource.reset}>
            <Suspense fallback={<SettingsLoading />}>
              <ActiveComponent />
            </Suspense>
          </ResourceBoundary>
        </main>
      </DashboardPageContent>
    </>
  )
}

export default function SettingsPage() {
  return <SettingsContent />
}
