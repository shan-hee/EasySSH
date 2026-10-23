
import type { LucideIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { preloadDashboardRoute } from "@/lib/dashboard-route-preload"
import { useIntentPreload } from "@/hooks/use-intent-preload"

interface NavigationItem {
  title: string
  url: string
  icon?: LucideIcon
  isActive?: boolean
}

function NavigationLink({ item, active }: { item: NavigationItem; active: boolean }) {
  const queryClient = useQueryClient()
  const preloadHandlers = useIntentPreload(intent => { void preloadDashboardRoute(item.url, queryClient, intent) })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
        <Link to={item.url} {...preloadHandlers}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavMain({ items, label = "Core" }: { label?: string; items: NavigationItem[] }) {
  const { pathname } = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map(item => (
          <NavigationLink key={item.url} item={item} active={pathname === item.url || (
            item.url !== "/dashboard" && pathname.startsWith(`${item.url}/`)
          )} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
