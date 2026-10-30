import * as DesktopServerService from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopserverservice"
import type { SshWorkspaceApiClient, SystemSnapshot } from "@easyssh/app/desktop"

export const desktopSystemInfoApi: NonNullable<SshWorkspaceApiClient["systemInfo"]> = {
  snapshot: async (serverId, kind) => await DesktopServerService.SystemSnapshot(serverId, kind) as SystemSnapshot,
}
