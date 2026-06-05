import type { SshWorkspacePreferenceAdapter } from "@easyssh/ssh-workspace/desktop"
import { DesktopService, type DesktopPreferenceSnapshot } from "../../bindings/github.com/easyssh/easyssh-desktop"

export type { DesktopPreferenceSnapshot }

export async function loadDesktopPreferenceSnapshot(): Promise<DesktopPreferenceSnapshot> {
  return await DesktopService.ListPreferences()
}

export function createDesktopPreferenceAdapter(
  initialSnapshot: DesktopPreferenceSnapshot,
): SshWorkspacePreferenceAdapter {
  const cache = new Map<string, string>()

  Object.entries(initialSnapshot).forEach(([key, value]) => {
    if (typeof value === "string") {
      cache.set(key, value)
    }
  })

  return {
    getString(key) {
      return cache.get(key) ?? null
    },
    setString(key, value) {
      cache.set(key, value)
      void DesktopService.SetPreference(key, value).catch((error) => {
        console.error("Failed to save desktop preference:", error)
      })
    },
    removeString(key) {
      cache.delete(key)
      void DesktopService.RemovePreference(key).catch((error) => {
        console.error("Failed to remove desktop preference:", error)
      })
    },
  }
}
