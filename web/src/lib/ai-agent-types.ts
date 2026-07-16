import type { UIMessage } from "@ai-sdk/react"

export interface AIConfigStatus {
  configured: boolean
  provider?: string
  model?: string
  models?: string[]
  has_key?: boolean
  message?: string
}

export type PermissionMode = "readonly" | "balanced" | "privileged"
export type AgentSessionStatus = "idle" | "running" | "waiting_confirmation" | "closed"
export type AgentTaskStatus = "queued" | "waiting_confirm" | "running" | "succeeded" | "failed" | "cancelled"
export type AgentTransportType = "ai_sdk_ui" | "desktop_local"

export interface AgentImageAttachment {
  id: string
  name: string
  media_type: string
  data: string
  size: number
}

export interface AgentUsage {
  input_tokens: number
  output_tokens: number
  cached_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  total_tokens: number
}

export interface AgentProviderMetadata {
  provider: string
  api: string
  endpoint?: string
  request_id?: string
  response_id?: string
  model?: string
  finish_reason?: string
  service_tier?: string
  estimated_cost_micros?: number
  cost_estimate_kind?: string
}

export interface ToolView {
  name: string
  display_name?: string
  description: string
  dangerous: boolean
}

export interface MessageView {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  reasoning?: string
  attachments?: AgentImageAttachment[]
  usage?: AgentUsage
  provider_metadata?: AgentProviderMetadata
  created_at: string
}

export interface TaskView {
  id: string
  assistant_message_id?: string
  tool_call_id: string
  tool_name: string
  tool_display_name?: string
  summary?: string
  status: AgentTaskStatus
  dangerous: boolean
  requires_confirmation: boolean
  arguments?: Record<string, unknown>
  result?: string
  error?: string
  created_at: string
  updated_at: string
  custom_title?: boolean
}

export interface SessionListItem {
  id: string
  model: string
  permission_mode: PermissionMode
  status: AgentSessionStatus
  title: string
  custom_title: boolean
  message_count: number
  task_count: number
  created_at: string
  updated_at: string
}

export interface AgentSessionScope {
  kind?: "global" | "terminal"
  terminal_session_id?: string
  server_id?: string
  server_name?: string
  host?: string
  port?: number
  username?: string
}

export interface SessionView {
  id: string
  model: string
  permission_mode: PermissionMode
  scope?: AgentSessionScope
  status: AgentSessionStatus
  created_at: string
  updated_at: string
  messages: MessageView[]
  tasks: TaskView[]
  ui_messages: UIMessage[]
  available_tools: ToolView[]
  default_transport: AgentTransportType
}

export interface CreateSessionInput {
  model?: string
  permission_mode?: PermissionMode
  scope?: AgentSessionScope
}

export interface CreateSessionResponse {
  session_id: string
  session: SessionView
  default_transport: AgentTransportType
}

export interface UpdateMessageInput {
  content: string
}

export interface ListSessionsResponse {
  items: SessionListItem[]
  total: number
}

export interface UserAIConfig {
  use_system_config: boolean
  custom_enabled: boolean
  custom_provider: string
  custom_endpoint: string
  custom_models: string
  has_api_key: boolean
}

export interface SaveUserAIConfigRequest {
  use_system_config: boolean
  custom_enabled: boolean
  custom_provider: string
  custom_api_key: string
  custom_endpoint: string
  custom_models: string
}
