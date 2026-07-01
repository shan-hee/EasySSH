import { Navigate, Route, Routes } from "react-router-dom"
import AuthLayout from "@/layouts/auth-layout"
import AuthTransition from "@/layouts/auth-transition"
import DashboardLayout from "@/layouts/dashboard-layout"
import ForgotPasswordPage from "@/pages/auth/forgot-password-page"
import GoogleAuthCallbackPage from "@/pages/auth/google-callback-page"
import LoginPage from "@/pages/auth/login-page"
import RegisterPage from "@/pages/auth/register-page"
import DashboardAISessionPage from "@/pages/dashboard/ai-assistant-page"
import AutomationSchedulesPage from "@/pages/dashboard/automation-schedules-page"
import DashboardError from "@/pages/dashboard/dashboard-error"
import LogsPage from "@/pages/dashboard/logs-page"
import OperationLogsPage from "@/pages/dashboard/operation-logs-page"
import DashboardOverviewPage from "@/pages/dashboard/overview-page"
import ScriptsPage from "@/components/dashboard/scripts/scripts-page"
import SettingsManagementPage from "@/pages/dashboard/settings-management-page"
import SettingsPage from "@/pages/dashboard/settings-page"
import TerminalPage from "@/pages/dashboard/terminal-page"
import UsersPage from "@/pages/dashboard/users-page"
import HomePage from "@/pages/home-page"
import SetupPage from "@/pages/setup-page"

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/auth/google/callback" element={<GoogleAuthCallbackPage />} />

      <Route element={<AuthLayout />}>
        <Route
          path="/login"
          element={
            <AuthTransition>
              <LoginPage />
            </AuthTransition>
          }
        />
        <Route
          path="/register"
          element={
            <AuthTransition>
              <RegisterPage />
            </AuthTransition>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <AuthTransition>
              <ForgotPasswordPage />
            </AuthTransition>
          }
        />
      </Route>

      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<DashboardOverviewPage />} />
        <Route path="terminal" element={<TerminalPage />} />
        <Route path="sftp" element={<Navigate to="/dashboard/terminal?sftpPicker=1" replace />} />
        <Route path="ai-assistant" element={<DashboardAISessionPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="operation-logs" element={<OperationLogsPage />} />
        <Route path="scripts" element={<ScriptsPage />} />
        <Route path="automation/schedules" element={<AutomationSchedulesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/management" element={<SettingsManagementPage />} />
        <Route path="error" element={<DashboardError error={new Error("Dashboard error")} reset={() => {}} />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
