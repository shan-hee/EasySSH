
import type { LucideIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { NavLink } from "react-router-dom"
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
        <NavLink to={item.url} end={item.url === "/dashboard"} {...preloadHandlers}>
          {({ isPending }) => <>
            {item.icon && <item.icon className={isPending ? "animate-pulse motion-reduce:animate-none" : undefined} />}
            <span aria-busy={isPending}>{item.title}</span>
          </>}
        </NavLink>
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
