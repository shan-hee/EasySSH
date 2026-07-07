import type {
  SshWorkspaceActivityLogAdapter,
  WorkspaceActivityLogRecordInput,
} from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import { mapNumberRecord } from "./desktop-adapter-utils"
import {
  mapDesktopActivityLogItem,
  mapWorkspaceActivityLogStatusToDesktop,
} from "./desktop-activity-log-mappers"

export function createDesktopActivityLogAdapter(): SshWorkspaceActivityLogAdapter {
  return {
    async list(params) {
      const result = await ActivityLogService.List({
        page: params?.page,
        limit: params?.limit,
        action: params?.action,
        serverId: params?.serverId,
        status: params?.status ? mapWorkspaceActivityLogStatusToDesktop(params.status) : undefined,
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        items: (result.items || []).map(mapDesktopActivityLogItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      }
    },
    async getById(id) {
      return mapDesktopActivityLogItem(await ActivityLogService.GetById(id))
    },
    async getStatistics(params) {
      const statistics = await ActivityLogService.GetStatistics({
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        total: statistics.total,
        successCount: statistics.successCount,
        failureCount: statistics.failureCount,
        byAction: mapNumberRecord(statistics.byAction),
      }
    },
    async record(input: WorkspaceActivityLogRecordInput) {
      return mapDesktopActivityLogItem(await ActivityLogService.Record({
        action: input.action,
        resource: input.resource,
        status: mapWorkspaceActivityLogStatusToDesktop(input.status),
        serverId: input.serverId,
        durationMs: input.durationMs,
        detail: input.detail,
      }))
    },
  }
}

export async function recordDesktopTerminalOpened(server: {
  id: string
  username: string
  host: string
  port: number
}): Promise<void> {
  await ActivityLogService.Record({
    action: "ssh_connect",
    resource: `${server.username}@${server.host}:${server.port}`,
    status: DesktopActivityLogStatus.DesktopActivityLogSuccess,
    serverId: server.id,
    detail: "Desktop command terminal opened",
  })
}
