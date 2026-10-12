import type { AgentSessionScope, CreateSessionInput, CreateSessionResponse, ListSessionsResponse, UpdateMessageInput } from "@/lib/ai-agent-types"
export type {
  AgentSessionScope,
  AgentServerReference,
  AgentSessionStatus,
  AgentImageAttachment,
  AgentProviderMetadata,
  AgentUsage,
  AgentTaskStatus,
  AgentTransportType,
  CreateSessionInput,
  CreateSessionResponse,
  ListSessionsResponse,
  MessageView,
  PermissionMode,
  SessionListItem,
  SessionView,
  TaskView,
  ToolView,
} from "@/lib/ai-agent-types"

const unavailable = (): never => { throw new Error("浏览器端不提供服务端 AI 代理，请使用桌面端 AI") }
export async function listAISessions(_input: { page?: number; limit?: number; q?: string; scope?: AgentSessionScope } = {}): Promise<ListSessionsResponse> { return unavailable() }
export async function getLatestAISession(_scope?: AgentSessionScope): Promise<CreateSessionResponse | null> { return unavailable() }
export async function getAISession(_id: string): Promise<CreateSessionResponse> { return unavailable() }
export async function createAISession(_input: CreateSessionInput): Promise<CreateSessionResponse> { return unavailable() }
export async function cancelAISession(_id: string): Promise<void> { return unavailable() }
export async function renameAISession(_id: string, _title: string): Promise<void> { return unavailable() }
export async function deleteAISession(_id: string): Promise<void> { return unavailable() }
export async function updateAIMessage(_id: string, _message: string, _input: UpdateMessageInput): Promise<CreateSessionResponse> { return unavailable() }
export async function deleteAIMessage(_id: string, _message: string): Promise<CreateSessionResponse> { return unavailable() }
