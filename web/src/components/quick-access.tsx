
import { useTranslation } from "react-i18next"

import { QuickAccessSearch } from "@/components/quick-access-search"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"

export function QuickAccess() {
  const { t: tDashboard } = useTranslation("dashboard")

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs font-medium text-muted-foreground">
        {tDashboard("quickAccessLabel")}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
          <QuickAccessSearch />
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
