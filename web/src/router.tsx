import type { ComponentType } from "react"
import { createBrowserRouter, redirectDocument, Navigate, type LoaderFunctionArgs, type RouteObject } from "react-router-dom"
import { App } from "./app"
import { isSharePage } from "./platform/access-session"
import { AppLoadingScreen } from "@easyssh/app/components/app-loading"
import { RouteErrorBoundary } from "./components/route-error-boundary"
import { ThemeProvider } from "@easyssh/app/components/theme-provider"
import { InstanceRestartPage } from "./pages/instance-restart-page"
import HomePage from "./pages/home-page"
import AuthTransition from "./layouts/auth-transition"
import { preloadNamespaces } from "@easyssh/app/i18n"
import { createQueryClient } from "@easyssh/app/lib/query-client"
import { dashboardRouteRegistry } from "./lib/dashboard-route-registry"
import { createDashboardPageLoader, requireDashboardAccess } from "./lib/dashboard-route-loader"

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

// 创建路由会立即执行当前地址的 loader，必须由入口在安装平台传输后调用。
export const createAppRouter = () => {
  // Cross an identity boundary with a full navigation so caches, streams and transport
  // are recreated together. Navigation inside one share remains client-side.
  const initialPath = window.location.pathname
  const shareRoute: RouteObject = { path: "/share/:publicId", loader: ({ request }) => new URL(request.url).pathname === initialPath ? null : redirectDocument(request.url), lazy: lazyPage(() => import("./pages/share-page"), ["sharing", "activityOverview", "terminal", "sftp", "servers", "terminalSettings", "aiAssistant", "taskCenter"]), ErrorBoundary: RouteErrorBoundary }
  const reload = ({ request }: LoaderFunctionArgs) => redirectDocument(request.url)
  if (isSharePage()) return createBrowserRouter([shareRoute, { path: "*", loader: reload }])
  return createBrowserRouter([
  { path: "/share/:publicId", loader: reload },
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
      { path: "setup", lazy: lazyPage(() => import("./pages/setup-page"), ["setup", "auth"]) },
      {
        lazy: lazyPage(() => import("./layouts/auth-layout"), ["auth"]),
        children: [
          { path: "login", lazy: lazyPage(() => import("./pages/auth/login-page"), ["auth"], true) },
        ],
      },
      {
        path: "dashboard",
        lazy: lazyPage(() => import("./layouts/dashboard-layout"), ["nav", "dashboard", "headerActions"]),
        loader: dashboardLoader,
        ErrorBoundary: RouteErrorBoundary,
        children: [
          ...dashboardRoutes,
          { path: "sync-authorize", loader: dashboardLoader, lazy: lazyPage(() => import("@easyssh/app/pages/dashboard/sync-authorize-page"), ["settingsManagementBackup"]), ErrorBoundary: RouteErrorBoundary },
          { path: "sftp", element: <Navigate to="/dashboard/terminal?sftpPicker=1" replace /> },
          { path: "error", lazy: async () => {
            const [{ default: DashboardError }] = await Promise.all([import("@easyssh/app/pages/dashboard/dashboard-error"), preloadNamespaces(["errors"])])
            return { Component: () => <DashboardError error={new Error("Dashboard error")} reset={() => window.location.reload()} /> }
          } },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
}
