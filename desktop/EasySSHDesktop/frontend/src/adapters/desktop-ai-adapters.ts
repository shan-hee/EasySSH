import type { AIAssistantPageAdapters } from "@/pages/dashboard/ai-assistant-page"
import type { AgentSessionScope } from "@/lib/api/ai-agent"
import type { SaveUserAIConfigRequest } from "@/lib/api/settings"
import type { ServerConnectionConfigsApi } from "@easyssh/ssh-workspace/desktop"
import * as DesktopAIService from "../../bindings/github.com/easyssh/easyssh-desktop/desktopaiservice"

const desktopAiConfigQueryKey = ["desktopAiConfig"]

export function createDesktopAIAssistantAdapters(serverApi: ServerConnectionConfigsApi): AIAssistantPageAdapters {
  return {
    aiConfig: {
      queryKey: desktopAiConfigQueryKey,
      getAIConfig: () => DesktopAIService.GetAIConfig(),
    },
    aiSettings: {
      queryKey: desktopAiConfigQueryKey,
      getUserAIConfig: () => DesktopAIService.GetUserAIConfig(),
      saveUserAIConfig: (config: SaveUserAIConfigRequest) => DesktopAIService.SaveUserAIConfig(config),
    },
    aiSession: {
      getSession: (sessionId: string) => DesktopAIService.GetSession(sessionId),
      getLatestSession: (scope?: AgentSessionScope) => DesktopAIService.GetLatestSession(scope),
      createSession: (input) => DesktopAIService.CreateSession(input),
      sendMessage: (input) => DesktopAIService.SendMessage(input),
      cancelSession: async (sessionId: string) => {
        await DesktopAIService.CancelSession(sessionId)
      },
      closeSession: async (sessionId: string) => {
        await DesktopAIService.CloseSession(sessionId)
      },
    },
    servers: {
      list: (params?: Parameters<ServerConnectionConfigsApi["list"]>[0]) => serverApi.list(params),
    },
    listAISessions: (input: {
      page?: number
      limit?: number
      q?: string
      scope?: AgentSessionScope
    } = {}) => DesktopAIService.ListSessions({
      page: input.page,
      limit: input.limit,
      q: input.q,
      scope_kind: input.scope?.kind,
      terminal_session_id: input.scope?.terminal_session_id,
      server_id: input.scope?.server_id,
    }),
    renameAISession: async (sessionId: string, title: string) => {
      await DesktopAIService.RenameSession(sessionId, title)
    },
    deleteAISession: async (sessionId: string) => {
      await DesktopAIService.DeleteSession(sessionId)
    },
  }
}

export type DesktopAIAssistantAdapters = ReturnType<typeof createDesktopAIAssistantAdapters>
