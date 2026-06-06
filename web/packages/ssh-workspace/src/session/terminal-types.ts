export type TerminalConnectionPhase =
  | "idle"
  | "ticket"
  | "ws_connecting"
  | "ssh_connecting"
  | "authenticating"
  | "ready"
  | "reconnecting"
  | "failed"
  | "closed"

export interface TerminalWebSocketAuthTicketRequest {
  type: "ws_terminal"
  server_id: string
}

export type TerminalWebSocketAuthTicketProvider = (
  request: TerminalWebSocketAuthTicketRequest,
) => Promise<string>

export interface TerminalWebSocketUrlRequest {
  serverId: string
  cols: number
  rows: number
  ticket: string
}

export type TerminalWebSocketUrlResolver = (
  request: TerminalWebSocketUrlRequest,
) => string | Promise<string>

export type TerminalWebSocketConstructor = new (url: string | URL, protocols?: string | string[]) => WebSocket
