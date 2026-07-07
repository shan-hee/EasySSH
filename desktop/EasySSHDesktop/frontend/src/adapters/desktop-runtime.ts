import type { RuntimeInfo } from "@easyssh/ssh-workspace/desktop"
import { DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop"

export interface DesktopGatewayInfo {
  httpBaseUrl?: string
  wsBaseUrl?: string
  token?: string
}

type DesktopRuntimeBindingBaseInfo = Awaited<ReturnType<typeof DesktopService.RuntimeInfo>>

export type DesktopRuntimeBindingInfo = DesktopRuntimeBindingBaseInfo & {
  gateway?: DesktopGatewayInfo
}

export type DesktopUpdateFailureNotice = {
  failed_at: string
  stage: string
  message: string
  target: string
  new_path?: string
  backup?: string
  log_path?: string
  relaunched_original: boolean
  manual_replace_target?: string
  manual_replace_source?: string
}

export function loadDesktopRuntime(): Promise<DesktopRuntimeBindingInfo> {
  return DesktopService.RuntimeInfo()
}

export async function getDesktopUpdateFailureNotice(): Promise<DesktopUpdateFailureNotice | null> {
  return await DesktopService.GetUpdateFailureNotice() as DesktopUpdateFailureNotice | null
}

export async function clearDesktopUpdateFailureNotice(): Promise<void> {
  await DesktopService.ClearUpdateFailureNotice()
}

export async function openDesktopPathInFileManager(path: string): Promise<void> {
  await DesktopService.OpenPathInFileManager(path)
}

export function createDesktopRuntime(runtime: DesktopRuntimeBindingInfo | null): RuntimeInfo {
  const runtimeCapabilities: RuntimeInfo["capabilities"] = runtime?.capabilities ?? {}

  return {
    profile: "desktop",
    principal: {
      kind: "local_owner",
      role: "owner",
    },
    single_user: true,
    portable: false,
    managed: false,
    data_dir: runtime?.dataDir,
    version: runtime?.version,
    capabilities: {
      ...runtimeCapabilities,
      servers: runtimeCapabilities.servers ?? true,
      terminal: runtimeCapabilities.terminal ?? true,
      sftp: runtimeCapabilities.sftp ?? true,
      transfers: runtimeCapabilities.transfers ?? true,
      monitoring: runtimeCapabilities.monitoring ?? true,
      docker: runtimeCapabilities.docker ?? true,
      ai: runtimeCapabilities.ai ?? true,
      activity_log: runtimeCapabilities.activity_log ?? true,
      settings: runtimeCapabilities.settings ?? true,
      desktop_data_dir: runtimeCapabilities.desktop_data_dir ?? true,
      open_data_dir: runtimeCapabilities.open_data_dir ?? true,
      portable_mode: runtimeCapabilities.portable_mode ?? false,
    },
  }
}
