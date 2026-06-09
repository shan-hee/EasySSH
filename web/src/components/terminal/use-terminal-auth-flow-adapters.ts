
import { useMemo } from "react"
import { toast } from "@/components/ui/sonner"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { serversApi } from "@/lib/api"
import { primaryCredentialMethod } from "@/lib/ssh-auth-methods"
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
      saveCredential: ({ serverId, authMethod, secret, password, privateKey }) => saveVerifiedCredential({
        serverId,
        authMethod,
        secret,
        password,
        privateKey,
      }),
    }
  }, [workspace?.adapters.apiClient?.terminal?.saveVerifiedCredential, workspace?.adapters.notifier])

  const defaultAuthFlowAdapters = useMemo<TerminalAuthFlowAdapters>(() => ({
    notifySuccess: toast.success,
    notifyError: toast.error,
    requestCredentialSave: ({ title, description, actionLabel, onConfirm }) => {
      toast(title, {
        description,
        action: {
          label: actionLabel,
          onClick: onConfirm,
        },
      })
    },
      saveCredential: ({ serverId, authMethod, secret, password, privateKey }) => {
        const payload = {
          auth_method: authMethod,
          verified_connection_credential: true,
          ...(password !== undefined ? { password } : {}),
          ...(privateKey !== undefined ? { private_key: privateKey } : {}),
          ...(password === undefined && privateKey === undefined
            ? primaryCredentialMethod(authMethod) === "key"
              ? { private_key: secret }
              : { password: secret }
            : {}),
        }

      return serversApi.update(serverId, payload)
    },
  }), [])

  return authFlowAdapters ?? workspaceAuthFlowAdapters ?? defaultAuthFlowAdapters
}
