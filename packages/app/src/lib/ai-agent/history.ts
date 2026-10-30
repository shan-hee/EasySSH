import type { UIMessage } from "ai"
import { readContentJSON, type ContentChunkReader } from "@/lib/content"
import type {
  AIHistoryKind,
  AIHistoryPage,
  AITaskOutputDelta,
  AITextDelta,
  CreateSessionResponse,
  MessageView,
  SessionOverview,
  SessionOverviewResponse,
  SessionView,
  TaskView,
} from "@/lib/ai-agent-types"

/** 宿主提供的历史读取：分页条目与大条目的分块正文。 */
export interface AIHistoryReader {
  page: (sessionId: string, kind: AIHistoryKind, afterId: string) => Promise<AIHistoryPage>
  readChunk: ContentChunkReader
}

type UIPart = UIMessage["parts"][number]
type LoosePart = Record<string, unknown>

// 单页最多 100 条；上限防止异常分页导致无限读取。
const MAX_HISTORY_PAGES = 1000

async function readHistoryKind<T>(sessionId: string, kind: AIHistoryKind, reader: AIHistoryReader): Promise<T[]> {
  const items: T[] = []
  let afterId = ""
  for (let pageIndex = 0; pageIndex < MAX_HISTORY_PAGES; pageIndex++) {
    const page = await reader.page(sessionId, kind, afterId)
    for (const item of page.items) {
      if (item.data !== undefined && item.data !== null) {
        items.push(item.data as T)
      } else if (item.content) {
        items.push(await readContentJSON<T>(item.content, reader.readChunk))
      }
    }
    if (!page.has_more || !page.next_after_id || page.next_after_id === afterId) return items
    afterId = page.next_after_id
  }
  throw new Error("AI history has too many pages")
}

/** 由会话概况与全部已提交历史组成前端会话。 */
export async function loadAISessionHistory(
  response: SessionOverviewResponse,
  reader: AIHistoryReader,
): Promise<CreateSessionResponse> {
  const [messages, tasks] = await Promise.all([
    readHistoryKind<MessageView>(response.session_id, "messages", reader),
    readHistoryKind<TaskView>(response.session_id, "tasks", reader),
  ])
  return {
    ...response,
    session: { ...response.session, messages, tasks, ui_messages: buildUIMessages(messages, tasks) },
  }
}

/** 新建的会话没有历史，无需读取。 */
export function withEmptyHistory(response: SessionOverviewResponse): CreateSessionResponse {
  return { ...response, session: { ...response.session, messages: [], tasks: [], ui_messages: [] } }
}

/** 实时概况只更新状态与标题等字段，保留已读取的历史。 */
export function mergeSessionOverview(session: SessionView, overview: SessionOverview): SessionView {
  return { ...session, ...overview, messages: session.messages, tasks: session.tasks, ui_messages: session.ui_messages }
}

export function isSessionOverview(value: unknown): value is SessionOverview {
  if (!value || typeof value !== "object") return false
  const overview = value as Partial<SessionOverview>
  return typeof overview.id === "string" && typeof overview.status === "string" && typeof overview.updated_at === "string"
}

function nonEmpty(...values: (string | undefined)[]) {
  return values.find((value) => value !== undefined && value.trim() !== "") ?? ""
}

/** 取出最后一个 `<tag>…</tag>` 段，返回段内容与去除该段后的正文。 */
function extractLastTagged(content: string, tag: string): [string, string] {
  const lower = content.toLowerCase()
  const open = `<${tag}>`
  const close = `</${tag}>`
  const start = lower.lastIndexOf(open)
  if (start < 0) return ["", content]
  const valueStart = start + open.length
  const end = lower.indexOf(close, valueStart)
  if (end < 0) return [content.slice(valueStart).trim(), content.slice(0, start).trim()]
  return [content.slice(valueStart, end).trim(), (content.slice(0, start) + content.slice(end + close.length)).trim()]
}

function assistantParts(message: MessageView): LoosePart[] {
  const [toolStatus, withoutToolStatus] = extractLastTagged(message.content, "tool-status")
  const [taggedReasoning, text] = extractLastTagged(withoutToolStatus, "think")
  const reasoning = message.reasoning?.trim() ? message.reasoning : taggedReasoning
  const parts: LoosePart[] = []
  if (toolStatus.trim()) {
    parts.push({ type: "data-tool-status", id: `${message.id}:tool-status`, data: { text: toolStatus.trim() } })
  }
  if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning.trim(), state: "done" })
  if (text.trim()) parts.push({ type: "text", text: text.trim(), state: "done" })
  if (message.stopped_at) {
    parts.push({ type: "data-stopped-run", id: `${message.id}:stopped`, data: { messageId: message.id, stoppedAt: message.stopped_at } })
  }
  return parts
}

function userMessage(message: MessageView): UIMessage {
  const parts: LoosePart[] = []
  if (message.content.trim()) parts.push({ type: "text", text: message.content, state: "done" })
  for (const attachment of message.attachments ?? []) {
    parts.push({
      type: "file",
      filename: attachment.name,
      mediaType: attachment.media_type,
      url: `data:${attachment.media_type};base64,${attachment.data}`,
    })
  }
  return {
    id: message.id,
    role: message.role === "system" ? "system" : "user",
    metadata: {
      source: "message",
      createdAt: message.created_at,
      originalRole: message.role,
      serverReferences: message.server_references,
    },
    parts: parts as UIPart[],
  }
}

/** 工具任务对应的 AI SDK 动态工具片段，与服务端流式输出一致。 */
export function taskUIPart(task: TaskView): UIPart {
  const part: LoosePart = {
    type: "dynamic-tool",
    toolName: task.tool_name,
    toolCallId: nonEmpty(task.tool_call_id, task.id),
    title: nonEmpty(task.tool_display_name, task.tool_name),
    providerExecuted: false,
    input: task.arguments ?? {},
    callProviderMetadata: {
      easyssh: {
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        taskId: task.id,
        assistantMessageId: task.assistant_message_id,
        taskStatus: task.status,
        file: task.file,
        dangerous: task.dangerous,
        requiresConfirmation: task.requires_confirmation,
        displayName: task.tool_display_name,
        summary: task.summary,
      },
    },
  }
  switch (task.status) {
    case "waiting_confirm":
      part.state = "approval-requested"
      part.approval = { id: task.id }
      break
    case "succeeded":
      part.state = "output-available"
      part.output = task.result ?? ""
      break
    case "unknown":
      part.state = "output-error"
      part.errorText = nonEmpty(task.error, task.result, "Execution outcome unknown; verify before retrying")
      break
    case "failed":
      part.state = "output-error"
      part.errorText = nonEmpty(task.error, "Tool execution failed")
      break
    case "cancelled":
      part.state = "output-denied"
      part.approval = { id: task.id, approved: false, reason: nonEmpty(task.error, task.result) }
      break
    default:
      part.state = "input-available"
  }
  return part as UIPart
}

function emptyAssistant(id: string, createdAt: string): UIMessage {
  return {
    id: id.trim() || "assistant",
    role: "assistant",
    metadata: { source: "message", createdAt, originalRole: "assistant" },
    parts: [],
  }
}

/**
 * 按创建时间合并消息与工具任务，得到 AI SDK UI 时间线。
 * 与共享包 aichatui.BuildMessages 保持同一规则，历史读取与实时流显示一致。
 */
export function buildUIMessages(messages: MessageView[], tasks: TaskView[]): UIMessage[] {
  type Item = { at: number; sequence: number; message?: MessageView; task?: TaskView }
  const items: Item[] = []
  let sequence = 0
  for (const message of messages) items.push({ at: Date.parse(message.created_at), sequence: sequence++, message })
  for (const task of tasks) items.push({ at: Date.parse(task.created_at), sequence: sequence++, task })
  items.sort((left, right) => (left.at === right.at || Number.isNaN(left.at - right.at) ? left.sequence - right.sequence : left.at - right.at))

  const result: UIMessage[] = []
  let assistant: UIMessage | null = null
  let stepSource = ""
  const startStep = (target: UIMessage, source: string) => {
    const nextSource = source.trim() || "assistant"
    if (stepSource === nextSource) return
    target.parts.push({ type: "step-start" } as UIPart)
    stepSource = nextSource
  }

  for (const item of items) {
    if (item.message) {
      const message = item.message
      if (message.role === "user" || message.role === "system") {
        result.push(userMessage(message))
        assistant = null
        stepSource = ""
      } else if (message.role === "assistant") {
        const parts = assistantParts(message)
        if (parts.length === 0) continue
        if (!assistant) {
          assistant = emptyAssistant(message.id, message.created_at)
          result.push(assistant)
        }
        startStep(assistant, message.id)
        assistant.parts.push(...(parts as UIPart[]))
      }
      continue
    }
    const task = item.task!
    if (!assistant) {
      assistant = emptyAssistant(nonEmpty(task.assistant_message_id, `task:${task.id}`), task.created_at)
      result.push(assistant)
    }
    startStep(assistant, nonEmpty(task.assistant_message_id, stepSource, `task:${task.id}`))
    assistant.parts.push(taskUIPart(task))
  }

  // 停止标记总在该消息末尾。
  for (const message of result) {
    const stopped = message.parts.filter((part) => part.type === "data-stopped-run")
    if (stopped.length > 0) message.parts = [...message.parts.filter((part) => part.type !== "data-stopped-run"), ...stopped]
  }
  return result
}

function textLength(part: UIPart | undefined) {
  return part && "text" in part && typeof part.text === "string" ? new TextEncoder().encode(part.text).length : 0
}

/** 按 UTF-8 字节偏移截取，与服务端偏移计算一致。 */
function sliceUtf8(text: string, bytes: number) {
  const encoded = new TextEncoder().encode(text)
  return new TextDecoder().decode(encoded.slice(0, bytes))
}

/**
 * 把桌面实时文本增量写入对应的助手消息。偏移与已收到内容不连续时返回 null，
 * 调用方应改为重新读取历史。
 */
export function applyTextDelta(messages: UIMessage[], delta: AITextDelta): UIMessage[] | null {
  const index = messages.findIndex((message) => message.id === delta.message_id)
  const current: UIMessage = index >= 0
    ? { ...messages[index]!, parts: [...messages[index]!.parts] }
    : { ...emptyAssistant(delta.message_id, delta.created_at), metadata: { source: "message", createdAt: delta.created_at, originalRole: "assistant", pending: true } }
  const partIndex = current.parts.findIndex((part) => part.type === delta.kind)
  const previous = partIndex >= 0 ? current.parts[partIndex] : undefined
  const received = textLength(previous)
  if (delta.offset > received) return null

  const base = previous && "text" in previous ? sliceUtf8(previous.text, delta.offset) : ""
  const next = { type: delta.kind, text: base + delta.text, state: "streaming" } as UIPart
  if (partIndex >= 0) {
    current.parts[partIndex] = next
  } else if (delta.kind === "reasoning") {
    current.parts.unshift(next)
  } else {
    current.parts.push(next)
  }

  if (index >= 0) {
    const result = [...messages]
    result[index] = current
    return result
  }
  return [...messages, current]
}

/** 把工具任务写入时间线：替换同一工具调用的片段，否则追加到所属助手消息。 */
export function upsertTaskUIPart(messages: UIMessage[], task: TaskView): UIMessage[] {
  const toolCallId = nonEmpty(task.tool_call_id, task.id)
  const part = taskUIPart(task)
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    const partIndex = message.parts.findIndex((item) => (item as LoosePart).toolCallId === toolCallId)
    if (partIndex < 0) continue
    const parts = [...message.parts]
    parts[partIndex] = part
    const result = [...messages]
    result[index] = { ...message, parts }
    return result
  }

  const ownerId = nonEmpty(task.assistant_message_id, `task:${task.id}`)
  const ownerIndex = messages.findIndex((message) => message.id === ownerId)
  if (ownerIndex >= 0) {
    const owner = messages[ownerIndex]!
    const result = [...messages]
    result[ownerIndex] = { ...owner, parts: [...owner.parts, part] }
    return result
  }
  return [...messages, { ...emptyAssistant(ownerId, task.created_at), parts: [{ type: "step-start" } as UIPart, part] }]
}

/** 实时任务元数据不含命令输出，合并时保留已收到的输出。 */
export function mergeTaskView(tasks: TaskView[], task: TaskView): TaskView[] {
  const previous = tasks.find((item) => item.id === task.id)
  const next = previous && !task.command_output ? { ...task, command_output: previous.command_output } : task
  return [...tasks.filter((item) => item.id !== task.id), next]
}

/** 应用命令输出增量；偏移不连续时返回 null，等待历史提交后刷新。 */
export function applyTaskOutputDelta(tasks: TaskView[], delta: AITaskOutputDelta): TaskView[] | null {
  const index = tasks.findIndex((task) => task.id === delta.task_id)
  if (index < 0) return null
  const task = tasks[index]!
  const previous = delta.reset ? "" : task.command_output ?? ""
  const received = new TextEncoder().encode(previous).length
  if (delta.offset > received) return null
  const result = [...tasks]
  result[index] = { ...task, command_output: sliceUtf8(previous, delta.offset) + delta.text }
  return result
}
