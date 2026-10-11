import { AppRouter } from "@/router"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { SystemConfigProvider } from "@/contexts/system-config-context"
import { DynamicHeadUpdater } from "@/components/dynamic-head-updater"
import { QueryProvider } from "@/providers/query-provider"
import { SessionRefreshProvider } from "@/providers/session-refresh-provider"
import { RuntimeProvider } from "@/shell/runtime/runtime-provider"
import { useLocation } from "react-router-dom"
import { InstanceRestartPage } from "@/pages/instance-restart-page"

export function App() {
  const location = useLocation()
  if (location.pathname === "/instance-restart") {
    return <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange><InstanceRestartPage /></ThemeProvider>
  }
  return (
    <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <RuntimeProvider>
          <SystemConfigProvider>
            <SessionRefreshProvider>
              <DynamicHeadUpdater />
              <AppRouter />
            </SessionRefreshProvider>
          </SystemConfigProvider>
        </RuntimeProvider>
      </QueryProvider>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  )
}
