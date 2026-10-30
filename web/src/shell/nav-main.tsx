import { NavLink, useLocation } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@easyssh/app/components/ui/sidebar"
import { useIntentPreload } from "@easyssh/app/hooks/use-intent-preload"
import type { NavigationItem } from "@easyssh/app/shell/navigation/navigation-registry"
import { preloadDashboardRoute } from "../lib/dashboard-route-preload"
import { DASHBOARD_PATH } from "./workspace-routes"

function isActivePath(pathname: string, url: string) {
  return pathname === url || (url !== DASHBOARD_PATH && pathname.startsWith(`${url}/`))
}

function NavigationLink({ item, active }: { item: NavigationItem; active: boolean }) {
  const queryClient = useQueryClient()
  const preloadHandlers = useIntentPreload((intent) => { void preloadDashboardRoute(item.url, queryClient, intent) })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
        <NavLink to={item.url} end={item.url === DASHBOARD_PATH} {...preloadHandlers}>
          {({ isPending }) => <>
            {item.icon && <item.icon className={isPending ? "animate-pulse motion-reduce:animate-none" : undefined} />}
            <span aria-busy={isPending}>{item.title}</span>
          </>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** 侧边栏中的一组导航。 */
export function NavMain({ items, label }: { label: string; items: readonly NavigationItem[] }) {
  const { pathname } = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <NavigationLink key={item.url} item={item} active={isActivePath(pathname, item.url)} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
