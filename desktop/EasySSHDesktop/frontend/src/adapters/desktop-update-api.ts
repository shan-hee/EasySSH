import { Call, Events } from "@wailsio/runtime"

const desktopUpdateServicePrefix = "github.com/easyssh/easyssh-desktop.DesktopUpdateService"
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

export const desktopUpdateApi = {
  getStatus(): Promise<DesktopUpdateCheckResult> {
    return Call.ByName(`${desktopUpdateServicePrefix}.GetUpdateStatus`)
  },

  checkForUpdate(): Promise<DesktopUpdateCheckResult> {
    return Call.ByName(`${desktopUpdateServicePrefix}.CheckForUpdate`)
  },

  installUpdate(): Promise<DesktopUpdateCheckResult> {
    return Call.ByName(`${desktopUpdateServicePrefix}.InstallUpdate`)
  },

  restartToUpdate(): Promise<void> {
    return Call.ByName(`${desktopUpdateServicePrefix}.RestartToUpdate`)
  },

  onProgress(callback: (progress: DesktopUpdateProgress) => void): () => void {
    return Events.On(desktopUpdateStatusEvent, (event) => {
      callback(event.data as DesktopUpdateProgress)
    })
  },
}
