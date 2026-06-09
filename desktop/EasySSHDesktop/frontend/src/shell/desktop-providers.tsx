import type { ReactNode } from "react"
import { BrowserRouter } from "react-router-dom"
import {
  DEFAULT_SYSTEM_CONFIG,
  SidebarProvider,
  StaticSystemConfigProvider,
  ThemeProvider,
  Toaster,
} from "@easyssh/ssh-workspace/desktop"
import { QueryProvider } from "@/providers/query-provider"

export function DesktopProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryProvider>
          <StaticSystemConfigProvider
            config={{
              ...DEFAULT_SYSTEM_CONFIG,
              system_name: "EasySSH Desktop",
            }}
          >
            <SidebarProvider defaultOpen={false} className="easyssh-desktop-sidebar-context">
              {children}
            </SidebarProvider>
          </StaticSystemConfigProvider>
        </QueryProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </BrowserRouter>
  )
}
