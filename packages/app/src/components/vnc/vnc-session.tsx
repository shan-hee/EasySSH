
import { useEffect, useRef, useState } from "react"
import type RFB from "@novnc/novnc"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getWebSocketUrl } from "@/lib/api-client"
import { connectionsApi } from "@/lib/api/connections"
import { createAccessTicket } from "@/lib/access-ticket"
import { SessionWorkspaceToolbar } from "@/components/tabs/session-workspace-toolbar"
import type { TerminalConnectionPhase } from "@/components/terminal/types"
import type { RemoteDesktopSocketFactory } from "@/lib/session/workspace"

export function VNCSession({ serverId, isActive, onPhase, createSocket }: { serverId: string; isActive: boolean; onPhase: (phase: TerminalConnectionPhase) => void; createSocket?: RemoteDesktopSocketFactory }) {
  const { t } = useTranslation("terminal")
  const container = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const client = useRef<RFB | null>(null)
  const phaseRef = useRef(onPhase)
  phaseRef.current = onPhase
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<TerminalConnectionPhase>("idle")
  const [error, setError] = useState("")
  const [requestedCredentials, setRequestedCredentials] = useState<string[]>([])
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [target, setTarget] = useState("")
  const [clipboard, setClipboard] = useState("")

  useEffect(() => {
    let disposed = false
    let connectionId: string | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let rfb: RFB | undefined
    const update = (next: TerminalConnectionPhase) => { if (!disposed) { setPhase(next); phaseRef.current(next) } }
    const release = () => {
      clearInterval(heartbeat)
      if (connectionId) { const id = connectionId; connectionId = undefined; void connectionsApi.close(id).catch(() => undefined) }
    }
    setError(""); setPassword(""); setRequestedCredentials([]); setClipboard("")
    const connect = async () => {
      update("ticket")
      const { default: RFBClient } = await import("@novnc/novnc")
      if (disposed) return
      const connection = await connectionsApi.create(serverId, "vnc")
      connectionId = connection.id
      if (disposed) { release(); return }
      const ticket = createSocket ? undefined : await createAccessTicket({ type: "ws_vnc", server_id: serverId, connection_id: connection.id })
      if (disposed || !container.current) { release(); return }
      update("ws_connecting")
      rfb = new RFBClient(container.current, createSocket
        ? createSocket(connection.id, "vnc")
        : getWebSocketUrl(`/api/v1/vnc/${encodeURIComponent(serverId)}/ws?ticket=${encodeURIComponent(ticket!)}`))
      client.current = rfb
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.addEventListener("connect", () => update("ready"))
      rfb.addEventListener("disconnect", event => {
        release()
        update(event.detail.clean ? "closed" : "failed")
        if (!disposed) { setPassword(""); setRequestedCredentials([]); if (!event.detail.clean) setError(t("vncDisconnected")) }
      })
      rfb.addEventListener("credentialsrequired", event => { if (!disposed) { setRequestedCredentials(event.detail.types); update("authenticating") } })
      rfb.addEventListener("securityfailure", () => { if (!disposed) setError(t("vncAuthenticationFailed")); update("failed") })
      rfb.addEventListener("clipboard", event => { if (!disposed) setClipboard(event.detail.text) })
      heartbeat = setInterval(() => { if (connectionId) void connectionsApi.heartbeat(connectionId).catch(() => { rfb?.disconnect(); release(); update("failed") }) }, connection.heartbeat_seconds * 1000)
    }
    void connect().catch(() => { release(); update("failed"); if (!disposed) setError(t("vncConnectionFailed")) })
    return () => { disposed = true; release(); rfb?.disconnect(); if (client.current === rfb) client.current = null }
  }, [serverId, attempt, t, createSocket])

  useEffect(() => { if (client.current) client.current.viewOnly = !isActive }, [isActive, phase])

  return <div ref={root} className="relative flex h-full min-h-0 flex-col bg-background">
    <SessionWorkspaceToolbar kind="vnc"><div className="flex flex-wrap items-center gap-2 border-b p-2">
      <span className="text-xs">noVNC · {phase === "ready" ? t("vncConnected") : t("vncNotConnected")}</span>
      <Button size="sm" variant="outline" onClick={() => { client.current?.disconnect(); setAttempt(n => n + 1) }}>{t("vncReconnect")}</Button>
      <Button size="sm" variant="outline" onClick={() => client.current?.disconnect()}>{t("vncDisconnect")}</Button>
      <Button size="sm" variant="outline" disabled={phase !== "ready"} onClick={() => client.current?.sendCtrlAltDel()}>Ctrl+Alt+Del</Button>
      <Button size="sm" variant="outline" onClick={() => { void root.current?.requestFullscreen().catch(() => setError(t("vncFullscreenFailed"))) }}>{t("vncFullscreen")}</Button>
      <Input className="h-8 w-48" aria-label={t("vncClipboard")} placeholder={t("vncClipboard")} value={clipboard} onChange={e => setClipboard(e.target.value)} />
      <Button size="sm" variant="outline" disabled={phase !== "ready"} onClick={() => client.current?.clipboardPasteFrom(clipboard)}>{t("vncSendClipboard")}</Button>
    </div></SessionWorkspaceToolbar>
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    {requestedCredentials.length > 0 && <form className="flex flex-wrap items-center gap-2 p-3" onSubmit={e => {
      e.preventDefault(); client.current?.sendCredentials({ username, password, target }); setPassword(""); setRequestedCredentials([])
    }}>
      {requestedCredentials.includes("username") && <Input className="w-48" aria-label={t("vncUsername")} placeholder={t("vncUsername")} value={username} onChange={e => setUsername(e.target.value)} />}
      {requestedCredentials.includes("target") && <Input className="w-48" aria-label={t("vncTarget")} value={target} onChange={e => setTarget(e.target.value)} />}
      {requestedCredentials.includes("password") && <Input autoFocus className="w-48" type="password" autoComplete="off" aria-label={t("vncPassword")} placeholder={t("vncPassword")} value={password} onChange={e => setPassword(e.target.value)} />}
      <Button type="submit">{t("vncAuthenticate")}</Button>
      <span className="text-xs text-muted-foreground">{t("vncPasswordTransient")}</span>
    </form>}
    <div ref={container} className="min-h-0 flex-1 overflow-hidden bg-black" />
  </div>
}
