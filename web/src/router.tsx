import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Spinner } from "@/components/ui/spinner"
import AuthLayout from "@/layouts/auth-layout"
import AuthTransition from "@/layouts/auth-transition"
import DashboardLayout from "@/layouts/dashboard-layout"

const HomePage = lazy(() => import("@/pages/home-page"))
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
  return (
    <div className="flex min-h-[16rem] flex-1 items-center justify-center" role="status">
      <Spinner className="size-7 text-muted-foreground" aria-label="Loading" />
    </div>
  )
}

function lazyElement(Page: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Page />
    </Suspense>
  )
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={lazyElement(HomePage)} />
      <Route path="/setup" element={lazyElement(SetupPage)} />
      <Route path="/auth/google/callback" element={lazyElement(GoogleAuthCallbackPage)} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<AuthTransition>{lazyElement(LoginPage)}</AuthTransition>} />
        <Route path="/register" element={<AuthTransition>{lazyElement(RegisterPage)}</AuthTransition>} />
        <Route path="/forgot-password" element={<AuthTransition>{lazyElement(ForgotPasswordPage)}</AuthTransition>} />
      </Route>

      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={lazyElement(DashboardOverviewPage)} />
        <Route path="terminal" element={lazyElement(TerminalPage)} />
        <Route path="sftp" element={<Navigate to="/dashboard/terminal?sftpPicker=1" replace />} />
        <Route path="ai-assistant" element={lazyElement(DashboardAISessionPage)} />
        <Route path="users" element={lazyElement(UsersPage)} />
        <Route path="logs" element={lazyElement(LogsPage)} />
        <Route path="operation-logs" element={lazyElement(OperationLogsPage)} />
        <Route path="scripts" element={lazyElement(ScriptsPage)} />
        <Route path="tasks" element={lazyElement(TaskCenterPage)} />
        <Route path="settings" element={lazyElement(SettingsPage)} />
        <Route path="settings/management" element={lazyElement(SettingsManagementPage)} />
        <Route
          path="error"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardError error={new Error("Dashboard error")} reset={() => {}} />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
