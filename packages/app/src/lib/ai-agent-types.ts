import type { UIMessage } from "@ai-sdk/react"
import type { components } from "@/generated/openapi"

export interface AIConfigStatus {
  configured: boolean
  provider?: string
  model?: string
  models?: string[]
  has_key?: boolean
  message?: string
}

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max"

export type PermissionMode = "readonly" | "balanced" | "privileged"
export type AgentSessionStatus = "idle" | "running" | "waiting_confirmation" | "closed"
export type AgentTaskStatus = "queued" | "waiting_confirm" | "running" | "succeeded" | "failed" | "unknown" | "cancelled"
export type AgentTransportType = "ai_sdk_ui"

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

export interface AgentServerReference {
  server_id: string
  name: string
  host: string
  port: number
  username: string
  label?: string
  offset?: number
}

export interface MessageView {
  external_content?: boolean
  server_references?: AgentServerReference[]
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  reasoning?: string
  attachments?: AgentImageAttachment[]
  usage?: AgentUsage
  provider_metadata?: AgentProviderMetadata
  created_at: string
  stopped_at?: string
}

export interface AgentFileSummary {
  name: string
  media_type: string
  size: number
  path?: string
  server_id?: string
  kind: "generated" | "read" | "modified"
}

export interface AgentFileArtifact extends AgentFileSummary {
  content: string
  encoding: "utf8" | "base64"
  before?: string
  existed: boolean
  baseline_hash?: string
}

export interface TaskView {
  file?: AgentFileSummary
  command_output?: string
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
}

export interface SessionListItem {
  preview?: string
  id: string
  model: string
  permission_mode: PermissionMode
  status: AgentSessionStatus
  scope?: AgentSessionScope
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

/** 会话概况；消息与工具正文从已提交的历史分页读取。 */
export interface SessionOverview {
  /** User-defined title; omitted until the session is renamed. */
  title?: string
  id: string
  model: string
  permission_mode: PermissionMode
  scope?: AgentSessionScope
  status: AgentSessionStatus
  created_at: string
  updated_at: string
  default_transport: AgentTransportType
  message_count?: number
  task_count?: number
}

/** 前端由概况与全部历史组合出的会话，含 AI SDK 时间线。 */
export interface SessionView extends SessionOverview {
  messages: MessageView[]
  tasks: TaskView[]
  ui_messages: UIMessage[]
}

export interface SessionOverviewResponse {
  session_id: string
  session: SessionOverview
  default_transport: AgentTransportType
}

export type AIHistoryKind = "messages" | "tasks"
export type AIHistoryPage = components["schemas"]["AIHistoryPage"]
export type AIHistoryChange = components["schemas"]["AIHistoryChange"]
export type AITextDelta = components["schemas"]["AITextDelta"]
export type AITaskOutputDelta = components["schemas"]["AITaskOutputDelta"]

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
  server_references: AgentServerReference[]
  content: string
}

export interface ListSessionsResponse {
  items: SessionListItem[]
  total: number
}

/** 所有者的 AI 服务配置；API 密钥只写不读。 */
export type AIConfig = components["schemas"]["OwnerAIConfig"]
export type AIConfigInput = components["schemas"]["AIConfigInput"]
export type AIModelsProbeInput = components["schemas"]["AIModelsProbeInput"]
export type AIModelsProbeResult = components["schemas"]["AIModelsProbeResult"]
