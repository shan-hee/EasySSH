import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { AppLoading, AppLoadingScreen } from "@/components/app-loading"
import AuthTransition from "@/layouts/auth-transition"
import HomePage from "@/pages/home-page"

const AuthLayout = lazy(() => import("@/layouts/auth-layout"))
const DashboardLayout = lazy(() => import("@/layouts/dashboard-layout"))
const SetupPage = lazy(() => import("@/pages/setup-page"))
const GoogleAuthCallbackPage = lazy(() => import("@/pages/auth/google-callback-page"))
const LoginPage = lazy(() => import("@/pages/auth/login-page"))
const RegisterPage = lazy(() => import("@/pages/auth/register-page"))
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password-page"))
const DashboardOverviewPage = lazy(() => import("@/pages/dashboard/overview-page"))
const TerminalPage = lazy(() => import("@/pages/dashboard/terminal-page"))
const DashboardAISessionPage = lazy(() => import("@/pages/dashboard/ai-assistant-page"))
const UsersPage = lazy(() => import("@/pages/dashboard/users-page"))
const LogsPage = lazy(() => import("@/pages/dashboard/logs-page"))
const OperationLogsPage = lazy(() => import("@/pages/dashboard/operation-logs-page"))
const ScriptsPage = lazy(() => import("@/components/dashboard/scripts/scripts-page"))
const TaskCenterPage = lazy(() => import("@/pages/dashboard/task-center-page"))
const SettingsPage = lazy(() => import("@/pages/dashboard/settings-page"))
const SettingsManagementPage = lazy(() => import("@/pages/dashboard/settings-management-page"))
const DashboardError = lazy(() => import("@/pages/dashboard/dashboard-error"))

function RouteFallback() {
  return <AppLoadingScreen />
}

function DashboardRouteFallback() {
  return (
    <div
      className="min-h-[520px] flex-1"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    />
  )
}

function lazyElement(
  Page: LazyExoticComponent<ComponentType>,
  fallback: ReactNode = <RouteFallback />,
) {
  return (
    <Suspense fallback={fallback}>
      <Page />
    </Suspense>
  )
}

function lazyDashboardElement(Page: LazyExoticComponent<ComponentType>) {
  return lazyElement(Page, <DashboardRouteFallback />)
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={lazyElement(SetupPage)} />
      <Route path="/auth/google/callback" element={lazyElement(GoogleAuthCallbackPage)} />

      <Route element={lazyElement(AuthLayout)}>
        <Route path="/login" element={<AuthTransition>{lazyElement(LoginPage, <AppLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
        <Route path="/register" element={<AuthTransition>{lazyElement(RegisterPage, <AppLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
        <Route path="/forgot-password" element={<AuthTransition>{lazyElement(ForgotPasswordPage, <AppLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
      </Route>

      <Route
        path="/dashboard"
        element={lazyElement(DashboardLayout, <AppLoadingScreen />)}
      >
        <Route index element={lazyDashboardElement(DashboardOverviewPage)} />
        <Route path="terminal" element={lazyDashboardElement(TerminalPage)} />
        <Route path="sftp" element={<Navigate to="/dashboard/terminal?sftpPicker=1" replace />} />
        <Route path="ai-assistant" element={lazyDashboardElement(DashboardAISessionPage)} />
        <Route path="users" element={lazyDashboardElement(UsersPage)} />
        <Route path="logs" element={lazyDashboardElement(LogsPage)} />
        <Route path="operation-logs" element={lazyDashboardElement(OperationLogsPage)} />
        <Route path="scripts" element={lazyDashboardElement(ScriptsPage)} />
        <Route path="tasks" element={lazyDashboardElement(TaskCenterPage)} />
        <Route path="settings" element={lazyDashboardElement(SettingsPage)} />
        <Route path="settings/management" element={lazyDashboardElement(SettingsManagementPage)} />
        <Route
          path="error"
          element={
            <Suspense fallback={<DashboardRouteFallback />}>
              <DashboardError error={new Error("Dashboard error")} reset={() => {}} />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
