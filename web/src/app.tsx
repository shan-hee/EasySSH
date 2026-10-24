import type { QueryClient } from "@tanstack/react-query"
import { NavigationProgress } from "@/components/navigation-progress"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { SystemConfigProvider } from "@/contexts/system-config-context"
import { DynamicHeadUpdater } from "@/components/dynamic-head-updater"
import { QueryProvider } from "@/providers/query-provider"
import { SessionRefreshProvider } from "@/providers/session-refresh-provider"
import { Outlet } from "react-router-dom"

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryProvider client={queryClient}>
        <SystemConfigProvider>
          <SessionRefreshProvider>
            <DynamicHeadUpdater />
            <NavigationProgress />
            <Outlet />
          </SessionRefreshProvider>
        </SystemConfigProvider>
      </QueryProvider>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  )
}
