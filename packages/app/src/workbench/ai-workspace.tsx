import { useEffect } from "react"
import {
  AIAssistantWorkspaceView,
  type AIAssistantWorkspaceViewProps,
} from "@/components/ai-agent/ai-assistant-workspace-view"
import { AISidebarHost, AISidebarTarget } from "@/components/ai-agent/ai-sidebar-host"
import { Sidebar, SidebarContent, SidebarRail, useSidebar } from "@/components/ui/sidebar"

export type AIWorkspaceProps = AIAssistantWorkspaceViewProps & {
  /**
   * 会话列表的位置：`inline` 在视图内自带可折叠栏（桌面）；
   * `host` 由宿主的侧边导航通过 AISidebarHost 承载（Web）。
   */
  sessionSidebar?: "inline" | "host"
}

/**
 * AI 工作内容：会话列表作为视图内的可折叠栏，或交给宿主侧边导航。
 * 离开视图时保持挂载，返回后保留当前会话与输入。
 */
export function AIWorkspace({ active = true, sessionSidebar = "inline", ...props }: AIWorkspaceProps) {
  if (sessionSidebar === "host") {
    return <AIAssistantWorkspaceView active={active} {...props} />
  }
  return <InlineSessionSidebarWorkspace active={active} {...props} />
}

function InlineSessionSidebarWorkspace({ active = true, ...props }: AIAssistantWorkspaceViewProps) {
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    if (!active) setOpenMobile(false)
  }, [active, setOpenMobile])

  return (
    <AISidebarHost>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {active && (
          <Sidebar collapsible="icon" className="absolute h-full">
            <SidebarContent className="overflow-hidden [scrollbar-gutter:auto]">
              <AISidebarTarget />
            </SidebarContent>
            <SidebarRail />
          </Sidebar>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AIAssistantWorkspaceView active={active} {...props} />
        </div>
      </div>
    </AISidebarHost>
  )
}
