import { AppRouter } from "@/router"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { SystemConfigProvider } from "@/contexts/system-config-context"
import { DynamicHeadUpdater } from "@/components/dynamic-head-updater"
import { QueryProvider } from "@/providers/query-provider"
import { SessionRefreshProvider } from "@/providers/session-refresh-provider"
import { RuntimeProvider } from "@/shell/runtime/runtime-provider"

export function App() {
  return (
    <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
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
