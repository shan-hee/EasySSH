import { Events } from "@wailsio/runtime"
import {
  DesktopUpdateService,
  type DesktopUpdateCheckResult as DesktopUpdateCheckResultModel,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

export const desktopUpdateStatusEvent = "easyssh:desktop:update-status"

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "error"

export type DesktopUpdateAsset = {
  filename: string
  download_url: string
  size?: number
  sha256?: string
  platform: string
  arch: string
}

export type DesktopUpdateCheckResult = {
  current_version: string
  latest_version: string
  has_update: boolean
  status: DesktopUpdateStatus
  release_url?: string
  published_at?: string
  notes?: string
  artifact?: DesktopUpdateAsset
  error?: string
}

export type DesktopUpdateProgress = {
  status: DesktopUpdateStatus
  current_version: string
  latest_version?: string
  written?: number
  total?: number
  rate?: number
  error?: string
  release_url?: string
}

const updateStatuses = new Set<string>([
  "idle",
  "checking",
  "up_to_date",
  "available",
  "downloading",
  "verifying",
  "ready",
  "error",
])

export const desktopUpdateApi = {
  async getStatus(): Promise<DesktopUpdateCheckResult> {
    return toDesktopUpdateCheckResult(await DesktopUpdateService.GetUpdateStatus())
  },

  async checkForUpdate(): Promise<DesktopUpdateCheckResult> {
    return toDesktopUpdateCheckResult(await DesktopUpdateService.CheckForUpdate())
  },

  async installUpdate(): Promise<DesktopUpdateCheckResult> {
    return toDesktopUpdateCheckResult(await DesktopUpdateService.InstallUpdate())
  },

  restartToUpdate(): Promise<void> {
    return DesktopUpdateService.RestartToUpdate()
  },

  onProgress(callback: (progress: DesktopUpdateProgress) => void): () => void {
    return Events.On(desktopUpdateStatusEvent, (event) => {
      callback(event.data as DesktopUpdateProgress)
    })
  },
}

function toDesktopUpdateCheckResult(result: DesktopUpdateCheckResultModel): DesktopUpdateCheckResult {
  return {
    current_version: result.current_version,
    latest_version: result.latest_version,
    has_update: result.has_update,
    status: toDesktopUpdateStatus(result.status),
    release_url: result.release_url,
    published_at: result.published_at,
    notes: result.notes,
    artifact: result.artifact
      ? {
          filename: result.artifact.filename,
          download_url: result.artifact.download_url,
          size: result.artifact.size,
          sha256: result.artifact.sha256,
          platform: result.artifact.platform,
          arch: result.artifact.arch,
        }
      : undefined,
    error: result.error,
  }
}

function toDesktopUpdateStatus(status: unknown): DesktopUpdateStatus {
  return typeof status === "string" && updateStatuses.has(status) ? status as DesktopUpdateStatus : "idle"
}
