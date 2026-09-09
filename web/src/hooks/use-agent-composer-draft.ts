import { useCallback, useSyncExternalStore, type SetStateAction } from "react"
import type { AssistantRuntime } from "@assistant-ui/react"

// Subscribe at the input, not the workspace: its controlled value must observe
// runtime writes in the same event, before React restores the textarea value.
export function useAgentComposerText(runtime: AssistantRuntime) {
  const composer = runtime.thread.composer
  const getText = useCallback(() => composer.getState().text, [composer])
  return useSyncExternalStore(composer.subscribe, getText, getText)
}

// Submission, templates and recovery only write on explicit actions. They must
// not re-render the workspace and republish the sidebar on every IME update.
export function useSetAgentComposerDraft(runtime: AssistantRuntime) {
  const composer = runtime.thread.composer
  return useCallback(
    (value: SetStateAction<string>) => {
      composer.setText(typeof value === "function" ? value(composer.getState().text) : value)
    },
    [composer]
  )
}
