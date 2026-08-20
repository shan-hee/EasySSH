
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

export function NavMain({
  items,
  label = "Core",
}: {
  label?: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
  }[]
}) {
  const { pathname } = useLocation()
  const queryClient = useQueryClient()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const active = pathname === item.url || (
            item.url !== "/dashboard" && pathname?.startsWith(`${item.url}/`)
          )

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
                <Link
                  to={item.url}
                  onPointerEnter={() => void preloadDashboardRoute(item.url, queryClient)}
                  onPointerDown={() => void preloadDashboardRoute(item.url, queryClient)}
                  onFocus={() => void preloadDashboardRoute(item.url, queryClient)}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
