import * as React from "react"
import { ChevronsUpDown, LogOut, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { SmartAvatar } from "@easyssh/app/components/ui/smart-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@easyssh/app/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@easyssh/app/components/ui/sidebar"
import { useClientAuth } from "@easyssh/app/components/client-auth-provider"
import { SettingsDialog } from "../components/settings-dialog"

/** 侧边栏底部的所有者账户：账户设置与登出。 */
export const NavUser = React.memo(function NavUser() {
  const { isMobile } = useSidebar()
  const { user, logout } = useClientAuth()
  const { t: tCommon } = useTranslation("common")
  const [settingsOpen, setSettingsOpen] = React.useState(() => (
    new URLSearchParams(window.location.search).get("account_settings") === "security"
  ))

  const handleLogout = React.useCallback(async () => {
    try {
      await logout()
    } catch {
      toast.error(tCommon("logoutFailed"))
    }
  }, [logout, tCommon])

  if (!user) return null

  const avatar = (
    <SmartAvatar
      className="h-8 w-8 rounded-lg"
      src={user.avatar || undefined}
      displayName={user.username}
      username={user.username}
      email={user.email}
    />
  )
  const identity = (
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.username}</span>
      <span className="truncate text-xs">{user.email}</span>
    </div>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatar}
              {identity}
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                {avatar}
                {identity}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings />
              {tCommon("accountSettings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              {tCommon("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
})
