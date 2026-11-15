
import { useMemo } from "react"
import { toast } from "@/components/ui/sonner"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import type { TerminalAuthFlowAdapters } from "./use-terminal-auth-flow"

export interface UseTerminalAuthFlowAdaptersOptions {
  authFlowAdapters?: TerminalAuthFlowAdapters
}

export function useTerminalAuthFlowAdapters({
  authFlowAdapters,
}: UseTerminalAuthFlowAdaptersOptions): TerminalAuthFlowAdapters {
  const workspace = useOptionalSshWorkspace()

  const workspaceAuthFlowAdapters = useMemo<TerminalAuthFlowAdapters | undefined>(() => {
    const notifier = workspace?.adapters.notifier
    const saveVerifiedCredential = workspace?.adapters.apiClient?.terminal?.saveVerifiedCredential

    if (!notifier?.action || !saveVerifiedCredential) {
      return undefined
    }

    return {
      notifySuccess: notifier.success,
      notifyError: notifier.error,
      requestCredentialSave: ({ title, description, actionLabel, onConfirm }) => notifier.action?.(title, {
        description,
        actionLabel,
        onAction: onConfirm,
      }),
      saveCredential: ({ serverId, authMethod, secret, password, privateKey, privateKeyPassphrase }) => saveVerifiedCredential({
        serverId,
        authMethod,
        secret,
        password,
        privateKey,
        privateKeyPassphrase,
      }),
    }
  }, [workspace?.adapters.apiClient?.terminal?.saveVerifiedCredential, workspace?.adapters.notifier])

  if (workspace?.capabilities.allowedActions) return { notifySuccess: toast.success, notifyError: toast.error }

  const adapters = authFlowAdapters ?? workspaceAuthFlowAdapters
  if (!adapters) throw new Error("Terminal authentication requires credential adapters")
  return adapters
}
