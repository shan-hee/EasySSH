import type { CreateScriptRequest, ListScriptsParams, ListScriptsResponse, Script, UpdateScriptRequest } from "@/lib/script-types"
import { configSnapshot, configuration, scheduleSync } from "@/lib/secure-runtime/records"
import { currentWorkspace } from "@/lib/secure-runtime/session"
export type { CreateScriptRequest, ListScriptsParams, ListScriptsResponse, Script, UpdateScriptRequest } from "@/lib/script-types"

function fromRecord(id: string, record: Record<string, string>): Script {
  return { id, user_id: currentWorkspace().owner, name: record.name, description: record.description, content: record.content,
    language: record.language, tags: JSON.parse(record.tags || "[]"), executions: 0, author: "", created_at: record.created_at, updated_at: record.updated_at }
}
export const scriptsApi = {
  async list(params?: ListScriptsParams): Promise<ListScriptsResponse> {
    if ((await currentWorkspace().conflicts("config", configuration)).some((c) => c.key.startsWith("script/") && c.field === "content")) throw new Error("脚本内容存在冲突，请先在加密工作区选择版本")
    const snapshot = await configSnapshot()
    const rows = Object.entries(snapshot).filter(([key]) => key.startsWith("script/")).map(([key, record]) => fromRecord(key.slice(7), record))
      .filter((s) => (!params?.search || [s.name, s.description].join(' ').toLocaleLowerCase().includes(params.search.toLocaleLowerCase())) &&
        (!params?.language || params.language === s.language) && (!params?.tags?.length || params.tags.every((tag) => s.tags.includes(tag))))
    const page = Math.max(1, params?.page || 1), limit = Math.max(1, params?.limit || 100)
    return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, total_pages: Math.ceil(rows.length / limit) }
  },
  async getById(id: string) { if ((await currentWorkspace().conflicts("config", configuration)).some((c) => c.key === "script/" + id && c.field === "content")) throw new Error("脚本内容存在冲突，请先选择版本"); const record = (await configSnapshot())['script/' + id]; if (!record) throw new Error("脚本不存在"); return fromRecord(id, record) },
  async create(data: CreateScriptRequest) { return save(crypto.randomUUID(), data, true) },
  async update(id: string, data: UpdateScriptRequest) { return save(id, data, false) },
  async delete(id: string) { await currentWorkspace().edit("config", configuration, (snapshot) => { delete snapshot['script/' + id]; return snapshot }); scheduleSync() },
  async execute(id: string) { await this.getById(id) },
}
async function save(id: string, data: UpdateScriptRequest, create: boolean) {
  await currentWorkspace().edit("config", configuration, (snapshot) => {
    if (!create && !snapshot['script/' + id]) throw new Error("脚本不存在")
    const old = snapshot['script/' + id] || { name: "", content: "", description: "", language: "bash", tags: "[]" }
    const record: Record<string, string> = { ...old, created_at: old.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, k === "tags" ? JSON.stringify(v) : String(v)])) }
    if (!record.name.trim() || !record.content || record.content.length > 1 << 20) throw new Error("脚本名称或内容无效")
    return { ...snapshot, ['script/' + id]: record }
  })
  scheduleSync(); return scriptsApi.getById(id)
}
