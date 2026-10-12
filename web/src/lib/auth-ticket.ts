import { apiFetch } from "@/lib/api-client"

export type AuthTicketType =
  | "instance_backup_download"
  | "ws_terminal"
  | "ws_ssh_relay"
  | "ws_monitor"
  | "ws_sftp_auth"
  | "ws_sftp_upload"
  | "ws_sftp_transfer"
  | "sftp_download"
  | "sftp_batch_download"

export interface CreateTicketInput {
  type: AuthTicketType
  backup_id?: string
  server_id?: string
  task_id?: string
  path?: string
  paths?: string[]
  mode?: string
  exclude_patterns?: string[]
}

export interface CreateTicketOutput {
  ticket: string
  expires_in: number
}

export async function createAuthTicket(input: CreateTicketInput): Promise<CreateTicketOutput> {
  if (input.type !== "ws_ssh_relay" && input.type !== "instance_backup_download") throw new Error("此票据仅由桌面本机传输提供")
  return apiFetch<CreateTicketOutput>("/auth/ticket", {
    method: "POST",
    body: input,
    retry: false,
    timeout: 10000,
  })
}
