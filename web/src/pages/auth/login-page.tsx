
import { LoginForm } from "@/components/login-form"
import { useAuthStatusRedirect } from "@/hooks/use-auth-status-redirect"
import { PageLoading } from "@/components/page-loading"

export default function LoginPage() {
  const { isChecking } = useAuthStatusRedirect("login")

  if (isChecking) {
    return <PageLoading className="min-h-[400px] bg-transparent" />
  }

  return <LoginForm />
}
