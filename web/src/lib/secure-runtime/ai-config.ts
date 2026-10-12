import type { SaveUserAIConfigRequest, UserAIConfig } from "@/lib/ai-agent-types"
import { currentWorkspace } from "./session"
import { scheduleSync } from "./records"

const key = "value/00000000-0000-4000-8000-000000000002"
type Config = { enabled: boolean; provider: string; endpoint: string; api_key: string; models: string }
async function read(): Promise<Config> {
  const record = (await currentWorkspace().snapshot("ai_config", "ai_config"))[key]
  return record ? JSON.parse(record.content).payload.ai_config : { enabled: false, provider: "openai", endpoint: "", api_key: "", models: "" }
}
export async function getClientAIConfig(): Promise<UserAIConfig> {
  const c = await read()
  return { use_system_config: false, custom_enabled: c.enabled, custom_provider: c.provider, custom_endpoint: c.endpoint, custom_models: c.models, has_api_key: !!c.api_key }
}
export async function saveClientAIConfig(input: SaveUserAIConfigRequest) {
  const workspace = currentWorkspace()
  await workspace.edit("ai_config", "ai_config", (snapshot) => {
    const old = snapshot[key] ? JSON.parse(snapshot[key].content).payload.ai_config as Config : undefined
    const config: Config = { enabled: input.custom_enabled, provider: input.custom_provider, endpoint: input.custom_endpoint, api_key: input.custom_api_key || old?.api_key || "", models: input.custom_models }
    return { ...snapshot, [key]: { content: JSON.stringify({ payload: { kind: "ai_config", source: "browser", updated_at: new Date().toISOString(), ai_config: config }, attachments: {} }) } }
  })
  scheduleSync()
}
export async function deleteClientAIConfig() {
  await saveClientAIConfig({ use_system_config: false, custom_enabled: false, custom_provider: "openai", custom_endpoint: "", custom_api_key: "", custom_models: "" })
  await currentWorkspace().edit("ai_config", "ai_config", (snapshot) => {
    const value = JSON.parse(snapshot[key].content); value.payload.ai_config.api_key = ""; snapshot[key] = { content: JSON.stringify(value) }; return snapshot
  })
  scheduleSync()
}
