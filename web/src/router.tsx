import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { AppLoadingScreen } from "@/components/app-loading"
import { PageLoading } from "@/components/page-loading"
import AuthTransition from "@/layouts/auth-transition"
import DashboardLayout from "@/layouts/dashboard-layout"
import HomePage from "@/pages/home-page"
import { dashboardRouteRegistry } from "@/lib/dashboard-route-registry"

const AuthLayout = lazy(() => import("@/layouts/auth-layout"))
const SetupPage = lazy(() => import("@/pages/setup-page"))
const GoogleAuthCallbackPage = lazy(() => import("@/pages/auth/google-callback-page"))
const LoginPage = lazy(() => import("@/pages/auth/login-page"))
const RegisterPage = lazy(() => import("@/pages/auth/register-page"))
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password-page"))
const DashboardError = lazy(() => import("@/pages/dashboard/dashboard-error"))

type RoutableComponent = ComponentType | LazyExoticComponent<ComponentType>

function RouteFallback() {
  return <AppLoadingScreen />
}

function DashboardRouteFallback() {
  return <PageLoading className="min-h-[520px] bg-transparent" />
}

function lazyElement(
  Page: RoutableComponent,
  fallback: ReactNode = <RouteFallback />,
) {
  return (
    <Suspense fallback={fallback}>
      <Page />
    </Suspense>
  )
}

function lazyDashboardElement(Page: ComponentType) {
  return lazyElement(Page, <DashboardRouteFallback />)
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={lazyElement(SetupPage)} />
      <Route path="/auth/google/callback" element={lazyElement(GoogleAuthCallbackPage)} />

      <Route element={lazyElement(AuthLayout)}>
        <Route path="/login" element={<AuthTransition>{lazyElement(LoginPage, <PageLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
        <Route path="/register" element={<AuthTransition>{lazyElement(RegisterPage, <PageLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
        <Route path="/forgot-password" element={<AuthTransition>{lazyElement(ForgotPasswordPage, <PageLoading className="min-h-[400px] bg-transparent" />)}</AuthTransition>} />
      </Route>

      <Route
        path="/dashboard"
        element={<DashboardLayout />}
      >
        {dashboardRouteRegistry.map(({ Page, index, path, url }) => (
          index ? (
            <Route key={url} index element={lazyDashboardElement(Page)} />
          ) : (
            <Route key={url} path={path} element={lazyDashboardElement(Page)} />
          )
        ))}
        <Route path="sftp" element={<Navigate to="/dashboard/terminal?sftpPicker=1" replace />} />
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
