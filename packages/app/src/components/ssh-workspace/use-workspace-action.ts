import { useCallback } from "react"
import { useOptionalSshWorkspace } from "./ssh-workspace"
import type { components } from "@/generated/openapi"

/** Undefined scope is the owner's workspace; visitor scopes are explicit. */
export function useWorkspaceAction() {
  const actions = useOptionalSshWorkspace()?.capabilities.allowedActions
  return useCallback(
    (action: components["schemas"]["Action"]) =>
      actions === undefined || actions.includes(action),
    [actions],
  )
}
