import type { ReactNode } from "react"
import {
  BrowserRouter,
  CompletionConfigProvider,
  DEFAULT_SYSTEM_CONFIG,
  SidebarProvider,
  StaticSystemConfigProvider,
  ThemeProvider,
  Toaster,
} from "@easyssh/ssh-workspace/desktop"

export function DesktopProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
        <StaticSystemConfigProvider
          config={{
            ...DEFAULT_SYSTEM_CONFIG,
            system_name: "EasySSH Desktop",
          }}
        >
          <CompletionConfigProvider>
            <SidebarProvider defaultOpen={false} className="easyssh-desktop-sidebar-context">
              {children}
            </SidebarProvider>
          </CompletionConfigProvider>
        </StaticSystemConfigProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </BrowserRouter>
  )
}
