import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown"
import { cjk } from "@streamdown/cjk"
import { createCodePlugin, type ThemeInput } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import type { MermaidOptions } from "streamdown"
import { useAuiState } from "@assistant-ui/react"
import { StreamingText, streamingTextAnimation } from "./streaming-text"

// CSS variables update already-highlighted code synchronously with the application theme.
const syntaxTheme: ThemeInput = {
  name: "easyssh-tokens",
  colors: { "editor.background": "var(--background)", "editor.foreground": "var(--foreground)" },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "var(--muted-foreground)" }
    },
    {
      scope: ["keyword", "storage", "entity.name.tag"],
      settings: { foreground: "var(--primary)" }
    },
    {
      scope: ["string", "constant.numeric", "constant.language"],
      settings: { foreground: "var(--chart-2)" }
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "var(--chart-1)" }
    },
    { scope: ["entity.name.type", "support.type"], settings: { foreground: "var(--chart-3)" } },
    { scope: ["invalid"], settings: { foreground: "var(--destructive)" } }
  ]
}
const syntaxThemes: [ThemeInput, ThemeInput] = [syntaxTheme, syntaxTheme]
const code = createCodePlugin({ themes: syntaxThemes })
// Official assistant-ui Streamdown integration; shares the current part's stream state.
const plugins = { cjk, code, math, mermaid }
const diagramOptions: MermaidOptions = {
  config: {
    theme: "base",
    themeCSS: `
      .node rect, .node circle, .node ellipse, .node polygon, .node path, .actor {
        fill: var(--muted) !important; stroke: var(--border) !important;
      }
      .cluster rect { fill: var(--card) !important; stroke: var(--border) !important; }
      text, .label, .nodeLabel, .edgeLabel, .edgeLabel p, .messageText, .labelText {
        fill: var(--foreground) !important; color: var(--foreground) !important;
      }
      .edgeLabel, .edgeLabel p { background-color: var(--background) !important; }
      .flowchart-link, .messageLine0, .messageLine1, .actor-line {
        stroke: var(--muted-foreground) !important;
      }
      marker path { fill: var(--muted-foreground) !important; stroke: var(--muted-foreground) !important; }
    `
  }
}
export function MarkdownText() {
  const streaming = useAuiState((s) => s.message.status?.type === "running")
  return (
    <StreamingText streaming={streaming}>
      <StreamdownTextPrimitive
        plugins={plugins}
        shikiTheme={syntaxThemes}
        mermaid={diagramOptions}
        defer
        smooth
        animated={streaming ? streamingTextAnimation : false}
        caret="block"
        className="min-w-0 w-full text-sm leading-6 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      />
    </StreamingText>
  )
}
