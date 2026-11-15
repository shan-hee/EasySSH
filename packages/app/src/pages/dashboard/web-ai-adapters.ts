import type { AIAssistantWorkspaceAdapters } from "@/components/ai-agent/ai-assistant-workspace-view"
import type { AIAssistantConfigAdapter } from "@/components/ai-agent/ai-config-popover"
import { serversApi } from "@/lib/api/servers"
import { aiConfigApi, getAIConfig } from "@/lib/api/ai-config"
import {
  cancelAISession,
  createAISession,
  deleteAIMessage,
  deleteAISession,
  getAISession,
  getAITaskFile,
  getLatestAISession,
  listAISessions,
  renameAISession,
  updateAIMessage,
} from "@/lib/api/ai-agent"
import { getApiUrl } from "@/lib/api-client"
import { fetchAIChatStream } from "@/lib/ai-agent/stream-transport"

export const webAIAssistantAdapters: AIAssistantWorkspaceAdapters = {
  aiConfig: { getAIConfig, waitForAuth: true },
  aiSession: {
    getTaskFile: getAITaskFile,
    getSession: getAISession,
    getLatestSession: getLatestAISession,
    createSession: createAISession,
    updateMessage: ({ session_id, message_id, ...input }) => updateAIMessage(session_id, message_id, input),
    deleteMessage: ({ session_id, message_id }) => deleteAIMessage(session_id, message_id),
    cancelSession: cancelAISession,
    deleteSession: deleteAISession,
    chatStream: {
      fetch: fetchAIChatStream,
      getUrl: (sessionId) => getApiUrl(`/ai/sessions/${sessionId}/chat`),
    },
  },
  servers: serversApi,
  listAISessions,
  renameAISession,
  deleteAISession,
}

export const webAISettingsAdapter: AIAssistantConfigAdapter = {
  getConfig: aiConfigApi.get,
  saveConfig: aiConfigApi.save,
  probeModels: aiConfigApi.probeModels,
}
