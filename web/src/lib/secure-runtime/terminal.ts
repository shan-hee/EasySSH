import { setServerConnected } from "./connection-state"
import { serversApi } from "@/lib/api/servers"
import { scriptsApi } from "@/lib/api/scripts"
import type { CompletionFetchOptions, TerminalAuthMethod, TerminalAuthResponsePayload, TerminalConnectionPhase, TerminalWebSocketOptions } from "@/lib/websocket-terminal"
import { BrowserSSHClient, type BrowserAuthPrompt, type BrowserHostKey } from "./browser-ssh"
import { connectionCredentials } from "./records"
import { currentWorkspace } from "./session"
import type { SSHSession } from "@/lib/api/ssh"

const connections = new Map<string, Set<BrowserSSHClient>>()
const sessions = new Map<string, { session: SSHSession; terminal: BrowserTerminal }>()
export function localSSHSessions() { return [...sessions.values()].map(({ session }) => ({ ...session })) }
export function closeLocalSSHSession(id: string) { sessions.get(id)?.terminal.disconnect() }
export function connectedSSH(serverID: string) {
  const clients = connections.get(serverID)
  const client = clients && [...clients].at(-1)
  if (!client) throw new Error("请先连接此服务器的终端")
  return client
}

export class BrowserTerminal {
  private id = crypto.randomUUID()
  private client?: BrowserSSHClient
  private phase: TerminalConnectionPhase = "idle"
  private closed = false
  private auth?: BrowserAuthPrompt
  private host?: BrowserHostKey
  private retry?: (payload: TerminalAuthResponsePayload | null) => void
  private hostAccepted?: (accepted: boolean) => void
  private decoder = new TextDecoder()
  private authAttempts = 1
  private retryCredentials = false
  private retryKind: "credential_retry" | "private_key_passphrase" = "credential_retry"
  private reconnectAttempts = 0
  private connectedOnce = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private lock = () => this.disconnect()
  constructor(private options: TerminalWebSocketOptions, private credential?: TerminalAuthResponsePayload, private sftpOnly = false) {}
  private setPhase(phase: TerminalConnectionPhase) { this.phase = phase; this.options.onConnectionPhase?.(phase) }
  connect() { void this.start().catch((error) => { if (!this.closed) { this.setPhase("failed"); this.options.onError?.(error instanceof Error ? error : new Error(String(error))); this.disconnect() } }) }
  private async start() {
    if (this.closed || this.phase !== "idle") return
    const workspace = currentWorkspace()
    this.setPhase("ssh_connecting"); this.options.onConnecting?.()
    window.addEventListener("easyssh:workspace-locked", this.lock)
    const target = await serversApi.getById(this.options.serverId)
    const credentials = await connectionCredentials(target.id)
    try {
    if (this.credential) {
      credentials.password = this.credential.password ?? credentials.password
      credentials.private_key = this.credential.privateKey ?? credentials.private_key
      credentials.passphrase = this.credential.privateKeyPassphrase ?? credentials.passphrase
      target.auth_method = this.credential.authMethod ?? target.auth_method
      this.credential = undefined
    }
    if (this.closed) return
    if (this.retryCredentials || (target.auth_method.includes("password") && !credentials.password) || (target.auth_method.includes("key") && !target.auth_method.startsWith("keyboard") && !credentials.private_key)) {
      this.setPhase("authenticating")
      if (!this.options.onAuthPrompt) throw new Error("此设备没有所需凭据")
      const payload = await new Promise<TerminalAuthResponsePayload | null>((resolve) => {
        this.retry = resolve
        this.options.onAuthPrompt!({ request_id: "credentials", kind: this.retryKind, prompts: [], auth_method: target.auth_method, attempt: this.authAttempts, max_attempts: 3 },
          (value, cancelled, method) => this.sendAuthResponse("credentials", value, cancelled, method))
      })
      this.retry = undefined
      if (!payload || this.closed) return this.disconnect()
      credentials.password = payload.password ?? credentials.password
      credentials.private_key = payload.privateKey ?? credentials.private_key
      credentials.passphrase = payload.privateKeyPassphrase ?? credentials.passphrase
      target.auth_method = payload.authMethod || target.auth_method
    }
    this.retryCredentials = false
    const client = new BrowserSSHClient({
      output: (data, consumed) => { this.options.onData(this.decoder.decode(data, { stream: true }), consumed) },
      hostKey: (prompt) => { void (async () => {
        if ((await workspace.conflicts("config", "host-keys")).some((c) => c.key === `value/${target.id}`)) throw new Error("主机指纹存在冲突，请先在加密工作区确认")
        const saved = (await workspace.snapshot("config", "host-keys"))[`value/${target.id}`]
        const expected = saved ? JSON.parse(saved.content) : null
        if (this.closed) return
        if (expected?.host === target.host && expected?.port === target.port && expected?.fingerprint === prompt.fingerprint) return client.trust(prompt, true)
        this.host = prompt
        const accepted = await new Promise<boolean>((resolve) => {
          this.hostAccepted = resolve
          if (!this.options.onHostKeyPrompt) return resolve(false)
          this.options.onHostKeyPrompt({ request_id: prompt.id, host: target.host, port: target.port,
            expected_key: expected?.fingerprint || "", received_key: prompt.fingerprint, expected_key_type: expected?.algorithm || "", received_key_type: prompt.algorithm },
            (ok, fingerprint) => this.sendHostKeyResponse(prompt.id, ok, fingerprint))
        })
        this.hostAccepted = undefined; this.host = undefined
        if (this.closed) return
        if (accepted) await workspace.edit("config", "host-keys", (snapshot) => ({ ...snapshot, [`value/${target.id}`]: {
          content: JSON.stringify({ host: target.host, port: target.port, fingerprint: prompt.fingerprint, algorithm: prompt.algorithm }),
        } }))
        client.trust(prompt, accepted)
      })().catch((error) => { this.options.onError?.(error); this.disconnect() }) },
      auth: (prompt) => {
        this.auth = prompt; this.setPhase("authenticating")
        if (!this.options.onAuthPrompt) { client.answer(prompt, [], false); return }
        this.options.onAuthPrompt({ request_id: prompt.id, kind: "keyboard_interactive", name: prompt.user, instruction: prompt.instruction,
          prompts: prompt.questions.map((text, i) => ({ text, echo: prompt.echoes[i] })) }, (answers, cancelled, method) => this.sendAuthResponse(prompt.id, answers, cancelled, method))
      },
      ready: () => {
        if (this.closed) return client.close()
        const set = connections.get(target.id) ?? new Set(); set.add(client); connections.set(target.id, set); setServerConnected(target.id, true)
        sessions.set(this.id, { terminal: this, session: { id: this.id, server_id: target.id, user_id: workspace.owner, server_name: target.name, status: "active", started_at: new Date().toISOString() } })
        this.connectedOnce = true; this.reconnectAttempts = 0; this.authAttempts = 1
        this.setPhase("ready"); this.options.onHandshakeComplete?.(); this.options.onConnected?.()
        if (this.options.enableCompletionFetch !== false) this.fetchCompletionData()
      },
      error: (message) => {
        if (!this.connectedOnce && this.authAttempts < 3 && this.options.onAuthPrompt && /unable to authenticate|private_key_passphrase|password is required|private key is required/i.test(message)) {
          this.retryKind = /private_key_passphrase/.test(message) ? "private_key_passphrase" : "credential_retry"
          this.retryCredentials = true; this.authAttempts++; return
        }
        this.setPhase("failed"); this.options.onError?.(new Error(message))
      },
      closed: () => {
        if (this.closed) return
        if (connections.get(target.id)?.delete(client)) setServerConnected(target.id, false); sessions.delete(this.id)
        this.client = undefined
        if (this.retryCredentials || ((this.connectedOnce || this.reconnectAttempts > 0) && this.options.autoReconnect && this.reconnectAttempts < 5)) {
          this.connectedOnce = false; this.decoder = new TextDecoder(); this.setPhase("idle")
          const delay = this.retryCredentials ? 0 : Math.min(1000 * 2 ** this.reconnectAttempts++, 15000)
          this.reconnectTimer = setTimeout(() => this.connect(), delay)
        } else this.disconnect()
      },
    })
    this.client = client
    await client.connect(target, credentials, this.options.cols, this.options.rows, this.sftpOnly)
    }
    finally { credentials.password = credentials.private_key = credentials.passphrase = "" }
  }
  sendInput(data: string) { this.client?.input(data) }
  resize(cols: number, rows: number) { this.options.cols = cols; this.options.rows = rows; this.client?.resize(cols, rows) }
  fetchCompletionData(options = this.options.completionFetchOptions ?? {}) {
    void (async () => {
      const scripts = options.includeScripts === false ? [] : (await scriptsApi.list({ limit: 10000 })).data
      if (!this.closed) this.options.onCompletionData?.({ scripts, history: [], timestamp: Date.now() })
    })().catch(() => {})
  }
  sendAuthResponse(id: string, value: string[] | TerminalAuthResponsePayload, cancelled = false, method?: TerminalAuthMethod) {
    const payload = Array.isArray(value) ? { answers: value, authMethod: method } : value
    if (id === "credentials") this.retry?.(cancelled ? null : payload)
    else if (this.auth?.id === id) { this.client?.answer(this.auth, payload.answers ?? [], !cancelled); this.auth = undefined }
  }
  sendHostKeyResponse(id: string, accepted: boolean, fingerprint?: string) {
    if (this.host?.id === id) this.hostAccepted?.(accepted && (!fingerprint || fingerprint === this.host.fingerprint))
  }
  setCompletionFetchEnabled(enabled: boolean) { this.options.enableCompletionFetch = enabled }
  setCompletionFetchOptions(options?: CompletionFetchOptions) { this.options.completionFetchOptions = options }
  setAutoReconnect(enabled: boolean) { this.options.autoReconnect = enabled }
  disconnect() {
    if (this.closed) return
    this.closed = true; this.retry?.(null); this.hostAccepted?.(false)
    clearTimeout(this.reconnectTimer)
    this.credential = undefined; this.auth = undefined; this.host = undefined
    sessions.delete(this.id)
    this.retry = undefined; this.hostAccepted = undefined
    window.removeEventListener("easyssh:workspace-locked", this.lock)
    if (this.client) { if (connections.get(this.options.serverId)?.delete(this.client)) setServerConnected(this.options.serverId, false); this.client.close(); this.client = undefined }
    if (!connections.get(this.options.serverId)?.size) connections.delete(this.options.serverId)
    this.setPhase("closed"); this.options.onDisconnected?.()
  }
  isConnected() { return this.phase === "ready" && !this.closed }
  getPhase() { return this.phase }
}
