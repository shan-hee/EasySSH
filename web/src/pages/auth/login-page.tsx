
import { LoginForm } from "@/components/login-form"
import { useAuthStatusRedirect } from "@/hooks/use-auth-status-redirect"
import { AppLoading } from "@/components/app-loading"

export default function LoginPage() {
  const { isChecking } = useAuthStatusRedirect("login")

  if (isChecking) {
    return <AppLoading className="min-h-[400px] bg-transparent" />
  }

  return <LoginForm />
}
