import { useEffect, useRef, useState } from "react"
import type { Client, Keyboard } from "guacamole-common-js"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getWebSocketUrl } from "@/lib/api-client"
import { connectionsApi } from "@/lib/api/connections"
import { createAccessTicket } from "@/lib/access-ticket"
import { SessionWorkspaceToolbar } from "@/components/tabs/session-workspace-toolbar"
import type { TerminalConnectionPhase } from "@/components/terminal/types"
import type { RemoteDesktopSocketFactory } from "@/lib/session/workspace"

export function RDPSession({ serverId, isActive, onPhase, createSocket }: { serverId: string; isActive: boolean; onPhase: (phase: TerminalConnectionPhase) => void; createSocket?: RemoteDesktopSocketFactory }) {
  const { t } = useTranslation("terminal")
  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const client = useRef<Client | null>(null)
  const keyboard = useRef<Keyboard | null>(null)
  const active = useRef(isActive)
  active.current = isActive
  const callback = useRef(onPhase)
  callback.current = onPhase
  const generation = useRef(0)
  const dispose = useRef<() => void>(() => undefined)
  const [phase, setPhase] = useState<TerminalConnectionPhase>("idle")
  const [username, setUsername] = useState("")
  const [domain, setDomain] = useState("")
  const [password, setPassword] = useState("")
  const [clipboard, setClipboard] = useState("")
  const [error, setError] = useState("")
  const busy = ["ticket", "ws_connecting", "authenticating"].includes(phase)
  const update = (value: TerminalConnectionPhase) => { setPhase(value); callback.current(value) }
  useEffect(() => () => { generation.current++; dispose.current() }, [serverId])
  useEffect(() => { if (!isActive) keyboard.current?.reset() }, [isActive])

  const connect = async () => {
    const credentials = { username, domain, password, width: Math.min(3840, Math.max(320, surface.current?.clientWidth || 1280)), height: Math.min(2160, Math.max(200, surface.current?.clientHeight || 720)) }
    setPassword(""); setError(""); setClipboard("")
    const attempt = ++generation.current
    dispose.current()
    const current = () => generation.current === attempt
    update("ticket")
    let connectionId: string | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let guac: Client | undefined
    let observer: ResizeObserver | undefined
    let element: HTMLElement | undefined
    const release = () => { clearInterval(heartbeat); if (connectionId) { const id = connectionId; connectionId = undefined; void connectionsApi.close(id).catch(() => undefined) } }
    let disposed = false
    dispose.current = () => { disposed = true; credentials.password = ""; observer?.disconnect(); keyboard.current?.reset(); keyboard.current = null; guac?.disconnect(); element?.remove(); release(); client.current = null }
    const fail = () => { if (!current() || disposed) return; update("failed"); setError(t("rdpConnectionFailed")); dispose.current() }
    try {
      const { default: G } = await import("guacamole-common-js")
      if (!current()) return
      const connection = await connectionsApi.create(serverId, "rdp")
      connectionId = connection.id
      if (!current()) { release(); return }
      const ticket = createSocket ? undefined : await createAccessTicket({ type: "ws_rdp", server_id: serverId, connection_id: connection.id })
      if (!current() || !surface.current) { release(); return }
      const url = createSocket ? "" : getWebSocketUrl(`/api/v1/rdp/${encodeURIComponent(serverId)}/ws?ticket=${encodeURIComponent(ticket!)}`)
      // Use a small authenticated transport. Each frame holds one instruction
      // array, avoiding the UTF-16/Unicode length mismatch of a string tunnel.
      class CredentialTunnel extends G.Tunnel {
        socket: WebSocket | null = null
        closing = false
        changeState = (state: import("guacamole-common-js").Tunnel.State) => { if (state !== this.state) { this.state = state; this.onstatechange?.(state) } }
        connect = () => {
          this.changeState(G.Tunnel.State.CONNECTING)
          const ws = this.socket = createSocket ? createSocket(connection.id, "rdp") : new WebSocket(url, "easyssh-rdp-v1")
          ws.onopen = () => { if (!current() || disposed) { ws.close(); return }; ws.send(JSON.stringify(credentials)); credentials.password = ""; update("authenticating") }
          ws.onmessage = event => {
            if (!current() || disposed) return
            try {
              const instruction: unknown = JSON.parse(event.data)
              if (!Array.isArray(instruction) || !instruction.length || !instruction.every(value => typeof value === "string")) throw new Error("Invalid instruction")
              const [opcode, ...args] = instruction as string[]
              if (opcode === "") { this.uuid = args[0]; this.onuuid?.(args[0]); this.changeState(G.Tunnel.State.OPEN) }
              else this.oninstruction?.(opcode, args)
            } catch { fail() }
          }
          ws.onerror = fail
          ws.onclose = () => { this.changeState(G.Tunnel.State.CLOSED); if (!this.closing) fail() }
        }
        disconnect = () => { this.closing = true; this.socket?.close(); this.changeState(G.Tunnel.State.CLOSED) }
        sendMessage = (...values: (string | number)[]) => { if (this.socket?.readyState === WebSocket.OPEN && this.isConnected()) this.socket.send(JSON.stringify(values.map(String))) }
      }
      const tunnel = new CredentialTunnel()
      guac = new G.Client(tunnel)
      const instance = guac
      client.current = instance
      instance.onerror = fail
      instance.onstatechange = state => { if (current() && !disposed && state === 3) update("ready") }
      instance.onclipboard = (stream, mimetype) => {
        if (mimetype !== "text/plain") { stream.sendAck("Unsupported clipboard type", 0x0100); return }
        let text = ""
        let exceeded = false
        const reader = new G.StringReader(stream)
        reader.ontext = chunk => { if (exceeded || text.length + chunk.length > 65536) { exceeded = true; stream.sendAck("Clipboard limit", 0x0308); return }; text += chunk; stream.sendAck("OK", 0) }
        reader.onend = () => { if (current() && !disposed && !exceeded) setClipboard(text) }
      }
      const display = instance.getDisplay()
      element = display.getElement()
      element.tabIndex = 0
      surface.current.appendChild(element)
      const mouse = new G.Mouse(element)
      mouse.onEach(["mousedown", "mouseup", "mousemove"], event => { if (!active.current) return; element?.focus(); instance.sendMouseState((event as unknown as { state: import("guacamole-common-js").Mouse.State }).state, true) })
      const keys = keyboard.current = new G.Keyboard(element)
      keys.onkeydown = keysym => { if (active.current) instance.sendKeyEvent(1, keysym); return false }
      keys.onkeyup = keysym => instance.sendKeyEvent(0, keysym)
      element.addEventListener("blur", () => keys.reset())
      const scale = () => { if (surface.current && display.getWidth() > 0) display.scale(Math.min(surface.current.clientWidth / display.getWidth(), surface.current.clientHeight / display.getHeight(), 1)) }
      display.onresize = scale
      observer = new ResizeObserver(scale)
      observer.observe(surface.current)
      heartbeat = setInterval(() => { if (connectionId) void connectionsApi.heartbeat(connectionId).catch(fail) }, connection.heartbeat_seconds * 1000)
      update("ws_connecting")
      instance.connect("")
    } catch { credentials.password = ""; fail() }
  }

  return <div ref={root} className="flex h-full min-h-0 flex-col bg-background">
    <SessionWorkspaceToolbar kind="rdp"><div className="flex flex-wrap items-center gap-2 border-b p-2">
      <span className="text-xs">RDP · {phase === "ready" ? t("vncConnected") : t("vncNotConnected")}</span>
      <Button size="sm" variant="outline" disabled={!busy && phase !== "ready"} onClick={() => { generation.current++; dispose.current(); update("closed") }}>{t("vncDisconnect")}</Button>
      <Button size="sm" variant="outline" disabled={phase !== "ready"} onClick={() => { for (const key of [0xffe3, 0xffe9, 0xffff]) client.current?.sendKeyEvent(1, key); for (const key of [0xffff, 0xffe9, 0xffe3]) client.current?.sendKeyEvent(0, key) }}>Ctrl+Alt+Del</Button>
      <Button size="sm" variant="outline" onClick={() => { void root.current?.requestFullscreen().catch(() => setError(t("vncFullscreenFailed"))) }}>{t("vncFullscreen")}</Button>
      <Input className="h-8 w-48" maxLength={65536} aria-label={t("vncClipboard")} placeholder={t("vncClipboard")} value={clipboard} onChange={e => setClipboard(e.target.value)} />
      <Button size="sm" variant="outline" disabled={phase !== "ready"} onClick={async () => { const { default: G } = await import("guacamole-common-js"); if (!client.current) return; const writer = new G.StringWriter(client.current.createClipboardStream("text/plain")); writer.sendText(clipboard); writer.sendEnd() }}>{t("vncSendClipboard")}</Button>
    </div></SessionWorkspaceToolbar>
    {phase !== "ready" && <form className="flex flex-wrap items-center gap-2 p-3" onSubmit={e => { e.preventDefault(); void connect() }}>
      <Input required disabled={busy} className="w-40" maxLength={256} aria-label={t("rdpUsername")} placeholder={t("rdpUsername")} value={username} onChange={e => setUsername(e.target.value)} />
      <Input disabled={busy} className="w-40" maxLength={256} aria-label={t("rdpDomain")} placeholder={t("rdpDomain")} value={domain} onChange={e => setDomain(e.target.value)} />
      <Input disabled={busy} className="w-40" maxLength={4096} type="password" autoComplete="off" aria-label={t("vncPassword")} placeholder={t("rdpPassword")} value={password} onChange={e => setPassword(e.target.value)} />
      <Button disabled={busy || !username.trim()} type="submit">{t("vncConnect")}</Button><span className="text-xs text-muted-foreground">{t("vncPasswordTransient")}</span>
    </form>}
    {error && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
    <div ref={surface} className="min-h-0 flex-1 overflow-hidden bg-black" />
  </div>
}
