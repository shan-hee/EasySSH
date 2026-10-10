import type { DiagramPlugin } from "@streamdown/mermaid"

// Streamdown requests an instance synchronously, but rendering is asynchronous.
// Load Mermaid only when a diagram is rendered, not for every Markdown message.
export const mermaid: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid(config) {
    let currentConfig = config
    return {
      initialize(nextConfig) {
        currentConfig = nextConfig
      },
      async render(id, source) {
        const { createMermaidPlugin } = await import("@streamdown/mermaid")
        return createMermaidPlugin().getMermaid(currentConfig).render(id, source)
      },
    }
  },
}
