import { Suspense, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Archive, Bot, Cable, Fingerprint, Globe, HardDrive, Mail, Settings, Shield, Workflow } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { cn } from "@/lib/utils"
import { BasicTab } from "./settings/system-config/_tabs/basic-tab"
import { FileTransferTab } from "./settings/system-config/_tabs/file-transfer-tab"
import { AuthenticationTab } from "./settings/security-center/_tabs/authentication-tab"
import { AccessControlTab } from "./settings/security-center/_tabs/access-control-tab"
import { NetworkSecurityTab } from "./settings/security-center/_tabs/network-security-tab"
import { WorkspaceTab } from "./settings/security-center/_tabs/workspace-tab"
import { BackupRestoreTab } from "@/components/settings/backup-restore-tab"
import { NotificationConfigWrapper } from "./settings/integrations/_tabs/notification-config-wrapper"
import { AIConfigWrapper } from "./settings/integrations/_tabs/ai-config-wrapper"

interface SettingsItem {
  id: string
  nameKey: string
  icon: React.ElementType
  component: React.ComponentType
}

interface SettingsGroup {
  id: string
  nameKey: string
  items: SettingsItem[]
}

const groups: SettingsGroup[] = [
  { id: "general", nameKey: "groupGeneral", items: [
    { id: "basic", nameKey: "itemBasic", icon: Settings, component: BasicTab },
  ] },
  { id: "identity", nameKey: "groupIdentity", items: [
    { id: "authentication", nameKey: "itemAuthentication", icon: Fingerprint, component: AuthenticationTab },
    { id: "access-control", nameKey: "itemAccessControl", icon: Shield, component: AccessControlTab },
  ] },
  { id: "workspace", nameKey: "groupWorkspace", items: [
    { id: "workspace", nameKey: "itemWorkspace", icon: Workflow, component: WorkspaceTab },
  ] },
  { id: "network", nameKey: "groupNetwork", items: [
    { id: "network", nameKey: "itemNetworkDeployment", icon: Globe, component: NetworkSecurityTab },
    { id: "file-transfer", nameKey: "itemFileTransfer", icon: Cable, component: FileTransferTab },
  ] },
  { id: "integrations", nameKey: "groupIntegrations", items: [
    { id: "ai-config", nameKey: "itemAIConfig", icon: Bot, component: AIConfigWrapper },
    { id: "notification-config", nameKey: "itemNotificationConfig", icon: Mail, component: NotificationConfigWrapper },
  ] },
  { id: "data", nameKey: "groupData", items: [
    { id: "backup", nameKey: "itemBackup", icon: Archive, component: BackupRestoreTab },
  ] },
]

const items = groups.flatMap((group) => group.items)

function NavigationButton({ item, active, onClick }: { item: SettingsItem; active: boolean; onClick: () => void }) {
  const { t } = useTranslation("settingsMain")
  return (
    <button
      type="button"
      onClick={onClick}
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
  const [activeSection, setActiveSection] = useState(items.some((item) => item.id === requestedSection) ? requestedSection : "basic")
  const activeItem = items.find((item) => item.id === activeSection) ?? items[0]
  const ActiveComponent = activeItem.component
  const ActiveIcon = activeItem.icon

  const selectSection = (section: string) => {
    setActiveSection(section)
    const next = new URLSearchParams(searchParams)
    next.set("section", section)
    navigate(`${pathname}?${next.toString()}`, { replace: true })
  }

  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 pb-4 pt-2 lg:flex-row lg:items-start">
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b pb-2 lg:hidden">
          {items.map((item) => (
            <div key={item.id} className="w-fit shrink-0">
              <NavigationButton item={item} active={item.id === activeSection} onClick={() => selectSection(item.id)} />
            </div>
          ))}
        </div>

        <aside className="hidden w-56 shrink-0 rounded-lg border bg-card p-3 lg:sticky lg:top-16 lg:block lg:max-h-[calc(100svh-5rem)] lg:overflow-y-auto scrollbar-custom">
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

        <main className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
          <div className="shrink-0 border-b px-4 py-3">
            <h1 className="flex items-center gap-2 text-base font-semibold"><ActiveIcon className="h-4 w-4" />{t(activeItem.nameKey)}</h1>
          </div>
          <ActiveComponent />
        </main>
      </div>
    </>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation("common")
  return <Suspense fallback={<div className="flex min-h-[20rem] flex-1 items-center justify-center">{t("loading")}</div>}><SettingsContent /></Suspense>
}
