import * as React from "react"
import { toast } from "@/components/ui/sonner"
import { updatesApi, type UpdateCheckResult } from "@/lib/api/updates"
import { viteEnv } from "@/lib/vite-env"

const updateCheckStorageKey = "easyssh:last-web-update-check"
const updateCheckIntervalMs = 24 * 60 * 60 * 1000
const defaultUpgradeCommand = "docker compose pull && docker compose up -d"
const currentWebVersion = viteEnv.VITE_APP_VERSION?.trim()

export type UpdateCheckTranslator = (key: string, options?: Record<string, unknown>) => string

interface UpdateCheckState {
  checking: boolean
  lastResult: UpdateCheckResult | null
}

const updateCheckListeners = new Set<(state: UpdateCheckState) => void>()
let updateCheckState: UpdateCheckState = {
  checking: false,
  lastResult: null,
}

function setUpdateCheckState(nextState: Partial<UpdateCheckState>) {
  updateCheckState = {
    ...updateCheckState,
    ...nextState,
  }

  updateCheckListeners.forEach((listener) => listener(updateCheckState))
}

function normalizeVersion(version?: string) {
  return version?.trim().replace(/^[vV]/, "") ?? ""
}

function normalizeWebUpdateResult(result: UpdateCheckResult): UpdateCheckResult {
  if (!currentWebVersion) {
    return result
  }

  const normalizedCurrent = normalizeVersion(currentWebVersion)
  const normalizedLatest = normalizeVersion(result.latest_version)
  const sameVersion = normalizedCurrent !== "" && normalizedCurrent === normalizedLatest

  return {
    ...result,
    current_version: currentWebVersion,
    has_update: sameVersion ? false : result.has_update,
  }
}

interface UseUpdateCheckOptions {
  auto?: boolean
}

export function useUpdateCheck(t: UpdateCheckTranslator, options: UseUpdateCheckOptions = {}) {
  const [state, setState] = React.useState<UpdateCheckState>(updateCheckState)
  const autoCheck = options.auto ?? true

  React.useEffect(() => {
    updateCheckListeners.add(setState)
    return () => {
      updateCheckListeners.delete(setState)
    }
  }, [])

  const notifyUpdate = React.useCallback(
    (result: UpdateCheckResult) => {
      const releaseUrl = result.release_url
      const title = t("updateAvailableTitle", { version: result.latest_version })
      const description = releaseUrl
        ? t("updateAvailableDescriptionWithLink")
        : t("updateAvailableDescription")

      toast(title, {
        description,
        action: releaseUrl
          ? {
              label: t("updateViewRelease"),
              onClick: () => {
                window.open(releaseUrl, "_blank", "noopener,noreferrer")
              },
            }
          : undefined,
      })
    },
    [t],
  )

  const checkForUpdates = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (updateCheckState.checking) {
        return null
      }

      setUpdateCheckState({ checking: true })
      if (typeof window !== "undefined") {
        window.localStorage.setItem(updateCheckStorageKey, String(Date.now()))
      }
      try {
        const result = normalizeWebUpdateResult(await updatesApi.checkWeb(currentWebVersion))
        setUpdateCheckState({ lastResult: result })

        if (result.has_update) {
          notifyUpdate(result)
        } else if (!options.silent) {
          toast.success(t("updateLatestTitle"), {
            description: t("updateLatestDescription", { version: result.current_version }),
          })
        }

        return result
      } catch (error) {
        if (!options.silent) {
          toast.error(t("updateCheckFailedTitle"), {
            description: getErrorMessage(error, t("updateCheckFailedDescription")),
          })
        }
        return null
      } finally {
        setUpdateCheckState({ checking: false })
      }
    },
    [notifyUpdate, t],
  )

  React.useEffect(() => {
    if (!autoCheck) {
      return
    }

    if (typeof window === "undefined") {
      return
    }

    const raw = window.localStorage.getItem(updateCheckStorageKey)
    const lastCheckedAt = raw ? Number(raw) : 0
    if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < updateCheckIntervalMs) {
      return
    }

    const timer = window.setTimeout(() => {
      void checkForUpdates({ silent: true })
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [autoCheck, checkForUpdates])

  const copyUpgradeCommand = React.useCallback(async () => {
    const command = state.lastResult?.instructions?.docker_compose || defaultUpgradeCommand
    try {
      await navigator.clipboard.writeText(command)
      toast.success(t("updateCommandCopied"))
    } catch {
      toast.error(t("updateCommandCopyFailed"))
    }
  }, [state.lastResult, t])

  return {
    checking: state.checking,
    lastResult: state.lastResult,
    checkForUpdates,
    copyUpgradeCommand,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("detail" in error) {
      const detail = error.detail
      if (typeof detail === "string") {
        return detail
      }
      if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
        return detail.message
      }
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message
    }
  }
  return fallback
}
