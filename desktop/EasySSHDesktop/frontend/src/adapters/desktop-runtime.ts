import type { RuntimeInfo } from "@easyssh/ssh-workspace/desktop"
import type { DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop"

export type DesktopRuntimeBindingInfo = Awaited<ReturnType<typeof DesktopService.RuntimeInfo>>

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
      sftp: false,
      transfers: false,
      monitoring: false,
      docker: false,
      ai: runtimeCapabilities.ai ?? true,
      activity_log: runtimeCapabilities.activity_log ?? true,
      settings: runtimeCapabilities.settings ?? true,
      desktop_data_dir: runtimeCapabilities.desktop_data_dir ?? true,
      open_data_dir: runtimeCapabilities.open_data_dir ?? true,
      portable_mode: runtimeCapabilities.portable_mode ?? false,
    },
  }
}
