import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from "react"
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

// Keep unsent text outside the runtime's current thread. The local new-chat
// draft uses null and is independent of every saved conversation.
export function useAgentComposerDrafts(runtime: AssistantRuntime, sessionId: string | null) {
  const drafts = useRef(new Map<string | null, string>())
  const activeId = useRef<string | null>(sessionId)
  const composer = runtime.thread.composer

  useLayoutEffect(() => {
    if (activeId.current === sessionId) return
    const text = composer.getState().text
    if (text) drafts.current.set(activeId.current, text)
    else drafts.current.delete(activeId.current)
    activeId.current = sessionId
    composer.setText(drafts.current.get(sessionId) ?? "")
  }, [composer, sessionId])

  const recover = useCallback((id: string | null, text: string) => {
    const current = activeId.current === id ? composer.getState().text : drafts.current.get(id) ?? ""
    const recovered = current && current !== text ? `${text}\n\n${current}` : text
    if (activeId.current === id) {
      composer.setText(recovered)
    } else {
      drafts.current.set(id, recovered)
    }
  }, [composer])

  const forget = useCallback((id: string) => {
    drafts.current.delete(id)
    if (activeId.current === id) composer.setText("")
  }, [composer])

  return { recover, forget }
}

// Reference chips belong to the same draft as the text, rather than leaking
// into whichever conversation happens to be selected when an async send ends.
export function useSessionDraftState<T>(sessionId: string | null, initialValue: T) {
  const drafts = useRef(new Map<string | null, T>())
  const initial = useRef(initialValue)
  const [, render] = useState(0)
  const setValue = useCallback((value: SetStateAction<T>, targetId = sessionId) => {
    const current = drafts.current.get(targetId) ?? initial.current
    drafts.current.set(targetId, typeof value === "function"
      ? (value as (current: T) => T)(current)
      : value)
    render((revision) => revision + 1)
  }, [sessionId])
  const forget = useCallback((id: string) => {
    drafts.current.delete(id)
    render((revision) => revision + 1)
  }, [])
  return [drafts.current.get(sessionId) ?? initial.current, setValue, forget] as const
}
