import { AccountSecurity } from "./settings/account-security"
import { AccountDevices } from "./settings/account-devices"
import { SyncPanel } from "@easyssh/app/components/settings/sync-panel"
import { webSyncAdapter } from "@easyssh/app/lib/sync/web-adapter"

import * as React from "react"

import { Bell, Lock, Key, User, Monitor, Info, RefreshCw } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@easyssh/app/components/ui/select"

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@easyssh/app/components/ui/sidebar"

import { useTranslation } from "react-i18next"

import { AccountProfile } from "./settings/account-profile"
import { AccountSSHKeys } from "@easyssh/app/components/settings/account-ssh-keys"
import { AccountNotifications } from "./settings/account-notifications"
import { AccountAbout } from "./settings/account-about"
import { SettingsLoading } from "@easyssh/app/components/settings/settings-loading"
type SettingsSection = "sync" | "profile" | "security" | "notifications" | "sshKeys" | "devices" | "about"

const settingsNavItems: { id: SettingsSection; icon: typeof User }[] = [
  { id: "profile", icon: User },
  { id: "security", icon: Lock },
  { id: "notifications", icon: Bell },
  { id: "sshKeys", icon: Key },
  { id: "devices", icon: Monitor },
  { id: "sync", icon: RefreshCw },
  { id: "about", icon: Info },
]

export default function AccountSettingsContent({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
const { t: tAccount } = useTranslation("accountSettings")
const [activeSection, setActiveSection] = React.useState<SettingsSection>("profile")
const handleSectionChange = setActiveSection
const navItems = settingsNavItems
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedSection = params.get("account_settings")
    if (!requestedSection) return

    if (requestedSection === "security") {
      setOpen(true)
      setActiveSection("security")
    }
    params.delete("account_settings")
    const query = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
  }, [setOpen])

  const getSectionLabel = React.useCallback(
    (section: SettingsSection) => {
      switch (section) {
        case "profile":
          return tAccount("navProfile")
        case "security":
          return tAccount("navSecurity")
        case "notifications":
          return tAccount("navNotifications")
        case "sshKeys":
          return tAccount("navSSHKeys")
        case "devices":
          return tAccount("navDevices")
        case "sync":
          return tAccount("navSync")
        case "about":
          return tAccount("navAbout")
        default:
          return ""
      }
    },
    [tAccount]
  )

return (<>
        <SidebarProvider className="h-full min-h-0">
          <Sidebar collapsible="none" className="hidden md:flex md:w-44 lg:w-48 border-r shrink-0">
            <SidebarContent className="py-4">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.id === activeSection}
                          onClick={() => handleSectionChange(item.id)}
                        >
                          <button>
                            <item.icon />
                            <span>{getSectionLabel(item.id)}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* 移动端导航 */}
            <div className="md:hidden border-b px-4 py-3">
              <Select
                value={activeSection}
                onValueChange={(value: SettingsSection) => handleSectionChange(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={tAccount("selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {navItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <div className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{getSectionLabel(item.id)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-custom">
              <div className={activeSection === "about" ? "flex min-h-full flex-col gap-6 p-6" : "space-y-6 p-6"}>
                <h3 className="shrink-0 text-lg font-semibold">
                  {getSectionLabel(activeSection)}
                </h3>
<React.Suspense key={activeSection} fallback={<SettingsLoading />}>
{open && <>
{activeSection === "profile" && <AccountProfile />}
{activeSection === "security" && <AccountSecurity />}
{activeSection === "devices" && <AccountDevices />}
{activeSection === "notifications" && <AccountNotifications />}
{activeSection === "sshKeys" && <AccountSSHKeys />}
{activeSection === "sync" && <SyncPanel adapter={webSyncAdapter} desktopMode={false} />}
{activeSection === "about" && <AccountAbout />}
</>}
</React.Suspense>
              </div>
            </div>
          </main>
        </SidebarProvider>
</>)
}
