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

export function DesktopProviders({
  children,
  aiAssistantActive = false,
}: {
  children: ReactNode
  aiAssistantActive?: boolean
}) {
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
        <QueryProvider>
          <StaticSystemConfigProvider
            config={{
              ...DEFAULT_SYSTEM_CONFIG,
              system_name: "EasySSH",
            }}
          >
            <SidebarProvider defaultOpen keyboardShortcutEnabled={aiAssistantActive}>
              {children}
            </SidebarProvider>
          </StaticSystemConfigProvider>
        </QueryProvider>
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
    </BrowserRouter>
  )
}
