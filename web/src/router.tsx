import type { ComponentType } from "react"
import { createBrowserRouter, Navigate, type LoaderFunctionArgs, type RouteObject } from "react-router-dom"
import { App } from "@/app"
import { AppLoadingScreen } from "@/components/app-loading"
import { RouteErrorBoundary } from "@/components/route-error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { InstanceRestartPage } from "@/pages/instance-restart-page"
import HomePage from "@/pages/home-page"
import AuthTransition from "@/layouts/auth-transition"
import { preloadNamespaces } from "@/i18n"
import { createQueryClient } from "@/lib/query-client"
import { dashboardRouteRegistry } from "@/lib/dashboard-route-registry"
import { createDashboardPageLoader, requireDashboardAccess } from "@/lib/dashboard-route-loader"

const queryClient = createQueryClient()

function lazyPage(load: () => Promise<{ default: ComponentType }>, namespaces: string[] = [], authTransition = false) {
  return async () => {
    const [module] = await Promise.all([load(), preloadNamespaces(["common", ...namespaces])])
    const Page = module.default
    return { Component: authTransition ? () => <AuthTransition><Page /></AuthTransition> : Page }
  }
}

async function dashboardLoader({ request }: LoaderFunctionArgs) {
  await requireDashboardAccess(queryClient, request)
  return null
}

const dashboardRoutes: RouteObject[] = dashboardRouteRegistry.map((route): RouteObject => ({
  ...(route.index ? { index: true } : { path: route.path }),
  lazy: lazyPage(route.load, route.namespaces),
  loader: createDashboardPageLoader(queryClient, route),
  ErrorBoundary: RouteErrorBoundary,
}))

export const router = createBrowserRouter([
  {
    path: "/instance-restart",
    element: <ThemeProvider defaultTheme="light" enableSystem disableTransitionOnChange><InstanceRestartPage /></ThemeProvider>,
    ErrorBoundary: RouteErrorBoundary,
  },
  {
    element: <App queryClient={queryClient} />,
    HydrateFallback: AppLoadingScreen,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: HomePage },
      { path: "setup", lazy: lazyPage(() => import("@/pages/setup-page"), ["setup", "auth"]) },
      { path: "auth/google/callback", lazy: lazyPage(() => import("@/pages/auth/google-callback-page"), ["auth"]) },
      {
        lazy: lazyPage(() => import("@/layouts/auth-layout"), ["auth"]),
        children: [
          { path: "login", lazy: lazyPage(() => import("@/pages/auth/login-page"), ["auth"], true) },
          { path: "register", lazy: lazyPage(() => import("@/pages/auth/register-page"), ["auth"], true) },
          { path: "forgot-password", lazy: lazyPage(() => import("@/pages/auth/forgot-password-page"), ["auth"], true) },
        ],
      },
      {
        path: "dashboard",
        lazy: lazyPage(() => import("@/layouts/dashboard-layout"), ["nav", "dashboard", "headerActions"]),
        loader: dashboardLoader,
        ErrorBoundary: RouteErrorBoundary,
        children: [
          ...dashboardRoutes,
          { path: "sync-authorize", loader: dashboardLoader, lazy: lazyPage(() => import("@/pages/dashboard/sync-authorize-page"), ["settingsManagementBackup"]), ErrorBoundary: RouteErrorBoundary },
          { path: "sftp", element: <Navigate to="/dashboard/terminal?sftpPicker=1" replace /> },
          { path: "error", lazy: async () => {
            const [{ default: DashboardError }] = await Promise.all([import("@/pages/dashboard/dashboard-error"), preloadNamespaces(["errors"])])
            return { Component: () => <DashboardError error={new Error("Dashboard error")} reset={() => window.location.reload()} /> }
          } },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
