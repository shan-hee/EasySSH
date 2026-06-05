// DesktopAIService binding. Kept handwritten so desktop AI can use Wails ByName
// without requiring binding generation during ordinary edits.

import { Call as $Call, type CancellablePromise as $CancellablePromise } from "@wailsio/runtime"

import type {
  AIConfigStatus,
  AgentSessionScope,
  CreateSessionResponse,
  ListSessionsResponse,
  PermissionMode,
  SaveUserAIConfigRequest,
  UserAIConfig,
} from "@/lib/ai-agent-types"

const service = "github.com/easyssh/easyssh-desktop.DesktopAIService"

export interface DesktopAIListSessionsParams {
  page?: number
  limit?: number
  q?: string
  scope_kind?: string
  terminal_session_id?: string
  server_id?: string
}

export interface DesktopAICreateSessionInput {
  model?: string
  permission_mode?: PermissionMode
  scope?: AgentSessionScope
}

export interface DesktopAISendMessageInput extends DesktopAICreateSessionInput {
  session_id: string
  content: string
  context?: string
}

export function GetAIConfig(): $CancellablePromise<AIConfigStatus> {
  return $Call.ByName(`${service}.GetAIConfig`)
}

export function GetUserAIConfig(): $CancellablePromise<UserAIConfig> {
  return $Call.ByName(`${service}.GetUserAIConfig`)
}

export function SaveUserAIConfig(input: SaveUserAIConfigRequest): $CancellablePromise<void> {
  return $Call.ByName(`${service}.SaveUserAIConfig`, input)
}

export function ListSessions(params: DesktopAIListSessionsParams): $CancellablePromise<ListSessionsResponse> {
  return $Call.ByName(`${service}.ListSessions`, params)
}

export function GetLatestSession(scope?: AgentSessionScope): $CancellablePromise<CreateSessionResponse | null> {
  return $Call.ByName(`${service}.GetLatestSession`, scope ?? {})
}

export function GetSession(id: string): $CancellablePromise<CreateSessionResponse> {
  return $Call.ByName(`${service}.GetSession`, id)
}

export function CreateSession(input: DesktopAICreateSessionInput): $CancellablePromise<CreateSessionResponse> {
  return $Call.ByName(`${service}.CreateSession`, input)
}

export function SendMessage(input: DesktopAISendMessageInput): $CancellablePromise<CreateSessionResponse> {
  return $Call.ByName(`${service}.SendMessage`, input)
}

export function CancelSession(id: string): $CancellablePromise<{ cancelled: boolean }> {
  return $Call.ByName(`${service}.CancelSession`, id)
}

export function RenameSession(id: string, title: string): $CancellablePromise<{ updated: boolean }> {
  return $Call.ByName(`${service}.RenameSession`, id, title)
}

export function DeleteSession(id: string): $CancellablePromise<void> {
  return $Call.ByName(`${service}.DeleteSession`, id)
}

export function CloseSession(id: string): $CancellablePromise<void> {
  return $Call.ByName(`${service}.CloseSession`, id)
}
