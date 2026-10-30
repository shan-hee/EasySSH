import { useState } from "react"
import { useLocation } from "react-router-dom"
import { SidebarProvider } from "@easyssh/app/components/ui/sidebar"

/**
 * 客户端侧边栏提供者
 * 纯 CSR 模式：从 localStorage 读取侧边栏状态
 */
export default function SidebarProviderServer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { pathname } = useLocation()
  const terminalActive = pathname === "/dashboard/terminal" || pathname.startsWith("/dashboard/terminal/")
  const [defaultOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true
    }

    const persisted = localStorage.getItem("sidebar_state")
    return persisted !== null ? persisted === "true" : true
  })

  return (
    <SidebarProvider
      keyboardShortcutEnabled={!terminalActive}
      defaultOpen={defaultOpen}
      className={className}
    >
      {children}
    </SidebarProvider>
  )
}
