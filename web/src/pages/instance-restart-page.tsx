import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getApiUrl } from "@/lib/config"
import { clearCSRFToken } from "@/lib/csrf"
import { suspendSessionRefresh } from "@/lib/session-refresh"
import { useAuthStore } from "@/stores/auth-store"
import type { components } from "@/types/openapi"

type Operation = components["schemas"]["InstanceActivationOperation"]

// This page lives outside the authenticated shell: a lost session must not
// interrupt tracking. The operation ID grants only access to its own status.
export function InstanceRestartPage() {
  const { t } = useTranslation("settingsManagementBackup")
  const [params] = useSearchParams()
  const id = params.get("operation") || ""
  const [operation, setOperation] = useState<Operation | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    void suspendSessionRefresh().then(() => {
      useAuthStore.getState().clearToken()
      clearCSRFToken()
    })
    if (!/^[a-f0-9]{64}$/.test(id)) { setTimedOut(true); return }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const deadline = Date.now() + 300_000
    setTimedOut(false)
    const poll = async () => {
      try {
        const response = await fetch(`${getApiUrl()}/backup/activation/status/${id}`, { cache: "no-store", credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
        if (response.ok) {
          const next = await response.json() as Operation
          if (!cancelled && next.id === id) {
            setOperation(next)
            if (next.status === "succeeded" || next.status === "rolled_back") return
          }
        }
      } catch { /* The backend is expected to be unreachable during restart. */ }
      if (cancelled) return
      if (Date.now() >= deadline) { setTimedOut(true); return }
      timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { cancelled = true; controller.abort(); clearTimeout(timer) }
  }, [id, attempt])

  const done = operation?.status === "succeeded" || operation?.status === "rolled_back"
  const message = timedOut ? "instanceRestartTimeout" : operation?.status === "succeeded" ? "instanceRestartSucceeded" : operation?.status === "rolled_back" ? "instanceRestartRolledBack" : "instanceRestartWaiting"
  return <main className="flex min-h-screen items-center justify-center bg-background p-6">
    <section className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-8 text-center" aria-live="polite">
      {operation?.status === "succeeded" ? <CheckCircle2 className="mx-auto size-10 text-green-600" /> : done || timedOut ? <AlertTriangle className="mx-auto size-10 text-amber-600" /> : <Loader2 className="mx-auto size-10 animate-spin text-primary" />}
      <h1 className="text-xl font-semibold">{t("instanceRestartTitle")}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{t(message)}</p>
      {done && <Button onClick={() => window.location.replace("/login")}>{t("instanceRestartLogin")}</Button>}
      {timedOut && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t("instanceRestartRetry")}</Button>}
    </section>
  </main>
}
