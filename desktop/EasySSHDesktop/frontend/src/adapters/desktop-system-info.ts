import { Call } from "@wailsio/runtime"
import type { SshWorkspaceApiClient } from "@easyssh/ssh-workspace/desktop"

export const desktopSystemInfoApi: NonNullable<SshWorkspaceApiClient["systemInfo"]> = {
  snapshot: (serverId, kind) => Call.ByName("main.DesktopServerService.SystemSnapshot", serverId, kind),
}
