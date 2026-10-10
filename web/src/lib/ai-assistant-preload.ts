import i18n from "i18next"
import { createPreloadableComponent } from "./preloadable-component"

export const { Component: PreloadedAgentThread, preload: loadAgentThread } = createPreloadableComponent(async () => {
  const [module] = await Promise.all([
    import("@/components/ai-agent/agent-thread"),
    i18n.loadNamespaces(["common", "aiAssistant"]),
  ])
  return { default: module.AgentThread }
})

export const { Component: PreloadedAiAssistantPanel, preload: loadAiAssistantPanel } = createPreloadableComponent(async () => {
  // 悬停、聚焦和直接打开共用入口，内部对话组件不再等面板挂载后才下载。
  const [module] = await Promise.all([
    import("@/components/terminal/ai-assistant-panel"),
    loadAgentThread(),
    i18n.loadNamespaces(["accountSettings"]),
  ])
  return { default: module.AiAssistantPanel }
})
