import { createPreloadableComponent } from "./preloadable-component"

export const { Component: PreloadedMonacoEditor, preload: loadFileEditor } = createPreloadableComponent(
  () => import("@/components/sftp/local-monaco-editor"),
)
