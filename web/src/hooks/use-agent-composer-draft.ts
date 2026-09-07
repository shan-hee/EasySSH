import { useCallback, useSyncExternalStore, type SetStateAction } from "react"
import type { AssistantRuntime } from "@assistant-ui/react"

// Read the runtime's draft outside its Provider so EasySSH's mention/context
// controls and submission handlers share the same state as Composer.Input.
export function useAgentComposerDraft(runtime: AssistantRuntime) {
  const composer = runtime.thread.composer
  const getText = useCallback(() => composer.getState().text, [composer])
  const text = useSyncExternalStore(composer.subscribe, getText, getText)
  const setText = useCallback(
    (value: SetStateAction<string>) => {
      composer.setText(typeof value === "function" ? value(composer.getState().text) : value)
    },
    [composer]
  )
  return [text, setText] as const
}
