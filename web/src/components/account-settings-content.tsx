import { AccountSecurity } from "@/components/settings/account-security"
import { AccountDevices } from "@/components/settings/account-devices"
import { SyncPanel } from "@/components/settings/sync-panel"
import { webSyncAdapter } from "@/lib/sync/web-adapter"

import * as React from "react"

import { Bell, Lock, Key, User, Monitor, Info, RefreshCw } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar"

import { useClientAuth } from "@/components/client-auth-provider"

import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/lib/error-utils"
import { AccountProfile } from "@/components/settings/account-profile"
import { AccountSSHKeys } from "@/components/settings/account-ssh-keys"
import { AccountNotifications } from "@/components/settings/account-notifications"
import { AccountAbout } from "@/components/settings/account-about"
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
const { refreshUser } = useClientAuth()
const [activeSection, setActiveSection] = React.useState<SettingsSection>("profile")
const handleSectionChange = setActiveSection
const navItems = settingsNavItems
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedSection = params.get("account_settings")
    const googleLinkResult = params.get("google_link")

    if (requestedSection === "security" || googleLinkResult) {
      setOpen(true)
      setActiveSection("security")
    }

    if (googleLinkResult === "success") {
      toast.success(tAccount("securityGoogleLinkedToast"))
      void refreshUser().catch((error: unknown) => {
        toast.error(getErrorMessage(error, tAccount("securityGoogleLinkFailed")))
      })
    } else if (googleLinkResult && googleLinkResult !== "success") {
      toast.error(params.get("google_message") || tAccount("securityGoogleLinkFailed"))
    }

    if (requestedSection || googleLinkResult || params.has("google_message")) {
      params.delete("account_settings")
      params.delete("google_link")
      params.delete("google_message")
      const query = params.toString()
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
      window.history.replaceState(null, "", nextUrl)
    }
  }, [refreshUser, setOpen, tAccount])

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
              <div className="space-y-6 p-6">
                <h3 className="text-lg font-semibold">
                  {getSectionLabel(activeSection)}
                </h3>
{open && <>
{activeSection === "profile" && <AccountProfile />}
{activeSection === "security" && <AccountSecurity />}
{activeSection === "devices" && <AccountDevices />}
{activeSection === "notifications" && <AccountNotifications />}
{activeSection === "sshKeys" && <AccountSSHKeys />}
{activeSection === "sync" && <SyncPanel adapter={webSyncAdapter} desktopMode={false} />}
{activeSection === "about" && <AccountAbout />}
</>}
              </div>
            </div>
          </main>
        </SidebarProvider>
</>)
}
