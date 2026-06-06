export {
  createCompositeWorkspaceSessionController,
  createCompositeWorkspaceSessionStoreAdapter,
  createWorkspaceAdapters,
  createWorkspaceAuthTicketProviderAdapter,
  createWorkspaceI18nAdapter,
  createWorkspaceNotifierAdapter,
  createWorkspaceSettingsAdapter,
  createWorkspaceTerminalAuthTicketProviderAdapter,
  createWorkspaceTransferAuthTicketProviderAdapter,
  createWorkspaceTransferManagerAdapter,
} from "../../../packages/ssh-workspace/src/session/workspace-adapters"
export type {
  CreateCompositeWorkspaceSessionStoreAdapterOptions,
  CreateWorkspaceAdaptersOptions,
  CreateWorkspaceI18nAdapterOptions,
  CreateWorkspaceSettingsAdapterOptions,
  CreateWorkspaceTransferManagerAdapterOptions,
  WorkspaceNotifierLike,
  WorkspaceTranslator,
  WorkspaceTranslatorLike,
} from "../../../packages/ssh-workspace/src/session/workspace-adapters"
import type { SshWorkspacePreferenceAdapter } from "../../../packages/ssh-workspace/src/session/workspace"

export interface WorkspacePreferenceStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

export interface CreateBrowserWorkspacePreferenceAdapterOptions {
  storage?: WorkspacePreferenceStorageLike | null
  keyPrefix?: string
}

export function createBrowserWorkspacePreferenceAdapter({
  storage,
  keyPrefix = "",
}: CreateBrowserWorkspacePreferenceAdapterOptions = {}): SshWorkspacePreferenceAdapter {
  const resolveStorage = () => {
    if (storage !== undefined) {
      return storage
    }

    return typeof window !== "undefined" ? window.localStorage : null
  }
  const resolveKey = (key: string) => `${keyPrefix}${key}`

  return {
    getString(key) {
      try {
        return resolveStorage()?.getItem(resolveKey(key)) ?? null
      } catch {
        return null
      }
    },
    setString(key, value) {
      try {
        resolveStorage()?.setItem(resolveKey(key), value)
      } catch (error) {
        void error
      }
    },
    removeString(key) {
      try {
        resolveStorage()?.removeItem?.(resolveKey(key))
      } catch (error) {
        void error
      }
    },
  }
}
