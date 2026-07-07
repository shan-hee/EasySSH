import { Events } from "@wailsio/runtime"
import type { TerminalWebSocketConstructor } from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopScriptService,
  DesktopServerAuthMethod,
  DesktopServerService,
  DesktopTerminalService,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

const desktopTerminalOutputEvent = "easyssh:desktop-terminal:output"
const desktopTerminalClosedEvent = "easyssh:desktop-terminal:closed"

interface DesktopTerminalOutputPayload {
  clientId?: string
  data?: string
}

interface DesktopTerminalClosedPayload {
  clientId?: string
  reason?: string
}

interface DesktopFetchCompletionData {
  historyLimit?: number
  includeHistory?: boolean
  includeScripts?: boolean
  cacheTtlMinutes?: number
  cacheMaxEntries?: number
}

interface DesktopCompletionUpdateData {
  newCommand?: string
}

type DesktopAuthMethod = "password" | "key"

interface DesktopTerminalCredential {
  authMethod: DesktopAuthMethod
  secret: string
  privateKeyPassphrase?: string
}

const getDesktopEventData = (event: unknown) => {
  return event && typeof event === "object" && "data" in event
    ? (event as { data?: unknown }).data
    : undefined
}

const getDesktopErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

const encodeDesktopTerminalInput = (data: string) => {
  const bytes = new TextEncoder().encode(data)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const decodeDesktopTerminalOutput = (data: string) => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

const createDesktopTerminalClientId = () => {
  return `desktop-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const desktopTerminalAuthMaxAttempts = 3
const desktopTerminalDefaultHistoryLimit = 500
const desktopTerminalMaxHistoryEntries = 5000
const desktopTerminalHistoryStoragePrefix = "easyssh:desktop:terminal-history:"

const getDesktopTerminalAuthMethod = (value?: string): DesktopAuthMethod => (
  value === "key" ? "key" : "password"
)

const toDesktopServerAuthMethod = (value?: DesktopAuthMethod) => {
  if (!value) return undefined
  return value === "key"
    ? DesktopServerAuthMethod.DesktopServerAuthKey
    : DesktopServerAuthMethod.DesktopServerAuthPassword
}

const normalizeDesktopTerminalHistoryLimit = (limit?: number) => {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return desktopTerminalDefaultHistoryLimit
  }
  return Math.min(Math.floor(limit), desktopTerminalMaxHistoryEntries)
}

const getDesktopTerminalHistoryStorageKey = (serverId: string) => {
  return `${desktopTerminalHistoryStoragePrefix}${serverId || "default"}`
}

const readDesktopTerminalHistory = (serverId: string) => {
  try {
    const raw = window.localStorage.getItem(getDesktopTerminalHistoryStorageKey(serverId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

const writeDesktopTerminalHistory = (serverId: string, history: string[]) => {
  try {
    window.localStorage.setItem(
      getDesktopTerminalHistoryStorageKey(serverId),
      JSON.stringify(history.slice(0, desktopTerminalMaxHistoryEntries)),
    )
  } catch {
    // Ignore storage quota or privacy-mode failures; completion still works in memory for the current session.
  }
}

const addDesktopTerminalHistoryCommand = (serverId: string, command?: string) => {
  const trimmed = command?.trim()
  if (!trimmed) {
    return
  }

  const nextHistory = [
    trimmed,
    ...readDesktopTerminalHistory(serverId).filter((item) => item !== trimmed),
  ].slice(0, desktopTerminalMaxHistoryEntries)
  writeDesktopTerminalHistory(serverId, nextHistory)
}

const getDesktopTerminalAuthErrorCode = (error: unknown) => {
  const message = getDesktopErrorMessage(error).toLowerCase()
  if (message.includes("host key verification failed")) return "host_key_changed"
  if (message.includes("host key trust has been revoked")) return "host_key_revoked"
  if (message.includes("private_key_passphrase_required")) return "private_key_passphrase_required"
  if (message.includes("private_key_passphrase_invalid")) return "private_key_passphrase_invalid"
  if (message.includes("server credential is required")) return "credential_required"
  if (
    message.includes("unable to authenticate") ||
    message.includes("permission denied") ||
    message.includes("authentication failed") ||
    message.includes("no supported methods remain")
  ) {
    return "auth_failed"
  }
  if (message.includes("failed to parse private key")) return "private_key_invalid"
  return "initialization_failed"
}

const isDesktopTerminalAuthRetryable = (error: unknown) => {
  const code = getDesktopTerminalAuthErrorCode(error)
  return code === "credential_required" || code === "auth_failed"
}

const isDesktopTerminalPassphraseError = (error: unknown) => {
  const code = getDesktopTerminalAuthErrorCode(error)
  return code === "private_key_passphrase_required" || code === "private_key_passphrase_invalid"
}

export function createDesktopTerminalSocket(): TerminalWebSocketConstructor {
  return class DesktopTerminalSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly url: string
    readonly extensions = ""
    readonly protocol = ""
    bufferedAmount = 0
    binaryType: BinaryType = "arraybuffer"
    readyState = DesktopTerminalSocket.CONNECTING
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null

    private readonly serverId: string
    private readonly clientId = createDesktopTerminalClientId()
    private readonly cols: number
    private readonly rows: number
    private destroyed = false
    private sshPingInFlight = false
    private sshLatency: { sshLatencyMs?: number; sshLatencyMeasuredAt?: number } = {}
    private readonly disposeOutput: () => void
    private readonly disposeClosed: () => void
    private pendingAuthPrompt: {
      requestId: string
      resolve: (credential: DesktopTerminalCredential | null) => void
    } | null = null

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      const params = new URL(this.url, window.location.href).searchParams
      this.serverId = params.get("serverId") || ""
      this.cols = Number(params.get("cols")) || 80
      this.rows = Number(params.get("rows")) || 24

      this.disposeOutput = Events.On(desktopTerminalOutputEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalOutputPayload | undefined
        if (!data || data.clientId !== this.clientId || !data.data) {
          return
        }

        try {
          this.emitMessage(decodeDesktopTerminalOutput(data.data))
        } catch (error) {
          this.emitError(getDesktopErrorMessage(error))
        }
      })

      this.disposeClosed = Events.On(desktopTerminalClosedEvent, (event) => {
        const data = getDesktopEventData(event) as DesktopTerminalClosedPayload | undefined
        if (!data || data.clientId !== this.clientId) {
          return
        }

        this.close(1000, data.reason || "remote closed")
      })

      window.setTimeout(() => {
        void this.start()
      }, 0)
    }

    close(code = 1000, reason = "closed") {
      if (this.readyState === DesktopTerminalSocket.CLOSED) return
      this.destroyed = true
      this.readyState = DesktopTerminalSocket.CLOSED
      if (this.pendingAuthPrompt) {
        this.pendingAuthPrompt.resolve(null)
        this.pendingAuthPrompt = null
      }
      this.disposeOutput()
      this.disposeClosed()
      void DesktopTerminalService.Close({ clientId: this.clientId }).catch(() => {})
      const event = new CloseEvent("close", { code, reason, wasClean: code === 1000 })
      this.onclose?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== DesktopTerminalSocket.OPEN) return
      if (typeof data === "string") {
        this.handleControlMessage(data)
        return
      }

      void DesktopTerminalService.Write({
        clientId: this.clientId,
        data: encodeDesktopTerminalInput(this.decodeInput(data)),
      }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
    }

    private handleControlMessage(raw: string) {
      try {
        const message = JSON.parse(raw) as { type?: string; data?: unknown }
        if (message.type === "ping") {
          const now = Date.now()
          const data = message.data && typeof message.data === "object"
            ? message.data as Record<string, unknown>
            : {}
          this.emitControl("pong", {
            ...data,
            ...this.sshLatency,
            serverRecvTs: now,
            serverSendTs: Date.now(),
          })
          void this.refreshSshLatency()
          return
        }
        if (message.type === "resize") {
          const data = message.data && typeof message.data === "object"
            ? message.data as { cols?: number; rows?: number }
            : {}
          void DesktopTerminalService.Resize({
            clientId: this.clientId,
            cols: data.cols || this.cols,
            rows: data.rows || this.rows,
          }).catch((error) => this.emitError(getDesktopErrorMessage(error)))
          return
        }
        if (message.type === "fetch_completion_data") {
          const data = message.data && typeof message.data === "object"
            ? message.data as DesktopFetchCompletionData
            : {}
          void this.fetchCompletionData(data)
          return
        }
        if (message.type === "completion_update") {
          const data = message.data && typeof message.data === "object"
            ? message.data as DesktopCompletionUpdateData
            : {}
          addDesktopTerminalHistoryCommand(this.serverId, data.newCommand)
          return
        }
        if (message.type === "auth_response") {
          const data = message.data && typeof message.data === "object"
            ? message.data as {
              request_id?: string
              answers?: string[]
              cancelled?: boolean
              auth_method?: DesktopAuthMethod
            }
            : {}
          if (this.pendingAuthPrompt && data.request_id === this.pendingAuthPrompt.requestId) {
            const pending = this.pendingAuthPrompt
            this.pendingAuthPrompt = null
            if (data.cancelled) {
              pending.resolve(null)
            } else {
              pending.resolve({
                authMethod: getDesktopTerminalAuthMethod(data.auth_method),
                secret: data.answers?.[0] ?? "",
              })
            }
          }
          return
        }
      } catch {
        // Ignore non-control strings.
      }
    }

    private requestCredential(serverName: string, authMethod: DesktopAuthMethod, attempt: number) {
      const requestId = `desktop-terminal-credential-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      return new Promise<DesktopTerminalCredential | null>((resolve) => {
        this.pendingAuthPrompt = {
          requestId,
          resolve,
        }
        this.emitControl("auth_prompt", {
          request_id: requestId,
          kind: "credential_retry",
          prompts: [{
            text: authMethod === "key" ? "Private key" : "Password",
            echo: false,
          }],
          auth_method: authMethod,
          attempt,
          max_attempts: desktopTerminalAuthMaxAttempts,
          attempts_remaining: desktopTerminalAuthMaxAttempts - attempt,
          name: serverName,
        })
      })
    }

    private requestPrivateKeyPassphrase(serverName: string, attempt: number) {
      const requestId = `desktop-terminal-passphrase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      return new Promise<string | null>((resolve) => {
        this.pendingAuthPrompt = {
          requestId,
          resolve: (credential) => resolve(credential?.secret ?? null),
        }
        this.emitControl("auth_prompt", {
          request_id: requestId,
          kind: "private_key_passphrase",
          prompts: [{
            text: "Private key passphrase",
            echo: false,
          }],
          auth_method: "key",
          attempt,
          max_attempts: desktopTerminalAuthMaxAttempts,
          attempts_remaining: desktopTerminalAuthMaxAttempts - attempt,
          name: serverName,
        })
      })
    }

    private async startDesktopTerminal(credential?: DesktopTerminalCredential | null) {
      await DesktopTerminalService.Start({
        clientId: this.clientId,
        serverId: this.serverId,
        cols: this.cols,
        rows: this.rows,
        authMethod: toDesktopServerAuthMethod(credential?.authMethod),
        secret: credential?.secret,
        privateKeyPassphrase: credential?.privateKeyPassphrase,
      })
    }

    private async fetchCompletionData(options: DesktopFetchCompletionData) {
      const history = options.includeHistory === false
        ? []
        : readDesktopTerminalHistory(this.serverId).slice(0, normalizeDesktopTerminalHistoryLimit(options.historyLimit))
      let scripts: {
        name: string
        content: string
        description: string
        executions: number
        tags: string[]
      }[] = []

      if (options.includeScripts !== false) {
        try {
          const result = await DesktopScriptService.List({ page: 1, limit: 1000 })
          scripts = (result.data || []).map((script) => ({
            name: script.name,
            content: script.content,
            description: script.description || "",
            executions: script.executions || 0,
            tags: script.tags || [],
          }))
        } catch (error) {
          console.error("Failed to load desktop completion scripts:", error)
        }
      }

      this.emitControl("completion_data", {
        history,
        scripts,
        timestamp: Date.now(),
      })
    }

    private async connectWithCredentialRetry() {
      const server = await DesktopServerService.GetById(this.serverId)
      const serverName = server.name || `${server.username}@${server.host}:${server.port}`
      const initialAuthMethod = getDesktopTerminalAuthMethod(server.auth_method)

      try {
        await this.startDesktopTerminal()
        return true
      } catch (error) {
        if (initialAuthMethod === "key" && isDesktopTerminalPassphraseError(error)) {
          let lastError = error

          for (let attempt = 1; attempt <= desktopTerminalAuthMaxAttempts; attempt += 1) {
            const passphrase = await this.requestPrivateKeyPassphrase(serverName, attempt)
            if (passphrase === null || this.destroyed) {
              this.close(1000, "authentication cancelled")
              return false
            }

            try {
              await this.startDesktopTerminal({
                authMethod: "key",
                secret: "",
                privateKeyPassphrase: passphrase,
              })
              return true
            } catch (nextError) {
              lastError = nextError
              if (!isDesktopTerminalPassphraseError(nextError)) {
                throw nextError
              }
            }
          }

          throw lastError
        }

        if (!isDesktopTerminalAuthRetryable(error)) {
          throw error
        }
      }

      let nextAuthMethod = initialAuthMethod
      let lastError: unknown = null

      for (let attempt = 1; attempt <= desktopTerminalAuthMaxAttempts; attempt += 1) {
        const credential = await this.requestCredential(serverName, nextAuthMethod, attempt)
        if (!credential || this.destroyed) {
          this.close(1000, "authentication cancelled")
          return false
        }
        nextAuthMethod = credential.authMethod

        try {
          await this.startDesktopTerminal(credential)
          return true
        } catch (error) {
          if (credential.authMethod === "key" && isDesktopTerminalPassphraseError(error)) {
            let passphraseError = error

            for (let passphraseAttempt = 1; passphraseAttempt <= desktopTerminalAuthMaxAttempts; passphraseAttempt += 1) {
              const passphrase = await this.requestPrivateKeyPassphrase(serverName, passphraseAttempt)
              if (passphrase === null || this.destroyed) {
                this.close(1000, "authentication cancelled")
                return false
              }

              try {
                await this.startDesktopTerminal({
                  ...credential,
                  privateKeyPassphrase: passphrase,
                })
                return true
              } catch (nextPassphraseError) {
                passphraseError = nextPassphraseError
                if (!isDesktopTerminalPassphraseError(nextPassphraseError)) {
                  throw nextPassphraseError
                }
              }
            }

            lastError = passphraseError
            throw lastError
          }

          lastError = error
          if (!isDesktopTerminalAuthRetryable(error)) {
            throw error
          }
        }
      }

      throw lastError ?? new Error("authentication failed")
    }

    private async refreshSshLatency() {
      if (this.sshPingInFlight || this.destroyed || this.readyState !== DesktopTerminalSocket.OPEN) {
        return
      }

      this.sshPingInFlight = true
      try {
        const result = await DesktopTerminalService.Ping({ clientId: this.clientId })
        this.sshLatency = {
          sshLatencyMs: result.latencyMs,
          sshLatencyMeasuredAt: result.measuredAt,
        }
      } catch {
        this.sshLatency = {}
      } finally {
        this.sshPingInFlight = false
      }
    }

    private async start() {
      if (this.destroyed) return

      this.readyState = DesktopTerminalSocket.OPEN
      this.emitOpen()
      this.emitControl("handshake_complete")

      try {
        const connected = await this.connectWithCredentialRetry()
        if (!connected) return

        if (this.destroyed) return

        this.emitControl("connected")
        void this.refreshSshLatency()
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
          serverId: this.serverId,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
      } catch (error) {
        const message = getDesktopErrorMessage(error)
        const errorCode = getDesktopTerminalAuthErrorCode(error)
        this.emitControl("error", {
          error: errorCode,
          message,
        })
        void ActivityLogService.Record({
          action: "ssh_connect",
          resource: this.serverId,
          status: DesktopActivityLogStatus.DesktopActivityLogFailure,
          serverId: this.serverId,
          detail: message,
        }).catch((error) => console.error("Failed to record desktop terminal activity:", error))
        this.close(1011, message)
      }
    }

    private emitOpen() {
      const event = new Event("open")
      this.onopen?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private emitControl(type: string, data?: unknown) {
      this.emitMessage(JSON.stringify({ type, data }))
    }

    private emitError(message: string) {
      this.emitControl("error", {
        error: "terminal_io_failed",
        message,
      })
    }

    private emitMessage(data: string | ArrayBuffer) {
      const event = new MessageEvent("message", { data })
      this.onmessage?.call(this as unknown as WebSocket, event)
      this.dispatchEvent(event)
    }

    private decodeInput(data: ArrayBufferLike | Blob | ArrayBufferView) {
      if (data instanceof Blob) return ""
      if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data)
      }
      return new TextDecoder().decode(data)
    }
  } as unknown as TerminalWebSocketConstructor
}
