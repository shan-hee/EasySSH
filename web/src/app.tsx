import type { QueryClient } from "@tanstack/react-query"
import { NavigationProgress } from "./components/navigation-progress"
import { ThemeProvider } from "@easyssh/app/components/theme-provider"
import { Toaster } from "@easyssh/app/components/ui/sonner"
import { SystemConfigProvider } from "./platform/system-config-provider"
import { DynamicHeadUpdater } from "./components/dynamic-head-updater"
import { QueryProvider } from "@easyssh/app/providers/query-provider"
import { Outlet } from "react-router-dom"

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryProvider client={queryClient}>
        <SystemConfigProvider>
          <DynamicHeadUpdater />
          <NavigationProgress />
          <Outlet />
        </SystemConfigProvider>
      </QueryProvider>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  )
}
