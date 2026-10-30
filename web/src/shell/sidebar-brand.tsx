import * as React from "react"
import { PanelLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@easyssh/app/components/ui/sidebar"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"
import { DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME } from "@easyssh/app/lib/brand"
import { DASHBOARD_PATH } from "./workspace-routes"

/** 侧边栏顶部的实例品牌：展开时点击回到仪表盘，收起时点击展开。 */
export const SidebarBrand = React.memo(function SidebarBrand() {
  const { toggleSidebar, state } = useSidebar()
  const navigate = useNavigate()
  const { config } = useSystemConfig()
  const { t } = useTranslation("nav")
  const name = config?.system_name || DEFAULT_BRAND_NAME

  const handleBrandClick = React.useCallback(() => {
    if (state === "expanded") navigate(DASHBOARD_PATH)
    else toggleSidebar()
  }, [navigate, state, toggleSidebar])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex w-full items-center">
          <SidebarMenuButton
            size="lg"
            className="group relative flex-1 group-data-[collapsible=icon]:cursor-ew-resize group-data-[collapsible=icon]:hover:bg-sidebar-accent group-data-[state=expanded]:cursor-pointer group-data-[state=expanded]:hover:bg-sidebar-accent"
            aria-label={state === "expanded" ? t("console") : t("toggleSidebar")}
            onClick={handleBrandClick}
          >
            <div className="relative flex aspect-square size-8 items-center justify-center rounded-lg">
              <img
                src={config?.system_logo || DEFAULT_BRAND_LOGO}
                alt={`${name} Logo`}
                width={24}
                height={24}
                className="size-6 transition-opacity group-data-[collapsible=icon]:group-hover:opacity-0"
              />
              {/* 收起时悬停显示展开图标 */}
              <PanelLeft className="absolute inset-0 m-auto size-4 opacity-0 transition-opacity group-data-[collapsible=icon]:group-hover:opacity-100" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
            </div>
          </SidebarMenuButton>
          <button
            type="button"
            onClick={toggleSidebar}
            className="ml-1 flex size-8 cursor-ew-resize items-center justify-center rounded hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
            aria-label={t("toggleSidebar")}
            title={t("toggleSidebar")}
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})
