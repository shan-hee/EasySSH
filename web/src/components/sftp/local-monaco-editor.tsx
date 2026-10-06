import Editor, { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor/editor/editor.api.js"
import "monaco-editor/features/register.all.js"
import "monaco-editor/basic-languages/monaco.contribution.js"
import "monaco-editor/language/json/monaco.contribution.js"
import "monaco-editor/language/css/monaco.contribution.js"
import "monaco-editor/language/html/monaco.contribution.js"
import "monaco-editor/language/typescript/monaco.contribution.js"
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker"
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker"
import CssWorker from "monaco-editor/language/css/css.worker.js?worker"
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker"
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker"

// 编辑器和语言服务都从本站加载，不依赖外部 CDN。
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new JsonWorker()
    if (["css", "scss", "less"].includes(label)) return new CssWorker()
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker()
    if (["typescript", "javascript"].includes(label)) return new TypeScriptWorker()
    return new EditorWorker()
  },
}
loader.config({ monaco })

export default Editor
