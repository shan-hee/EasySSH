import type {
  SshWorkspaceActivityLogAdapter,
  WorkspaceActivityLogRecordInput,
  WorkspaceActivityLogStatus,
} from "@easyssh/ssh-workspace/desktop"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  type DesktopActivityLogItem,
} from "../../bindings/github.com/easyssh/easyssh-desktop"

export function mapActivityLogStatus(status: WorkspaceActivityLogStatus): DesktopActivityLogStatus {
  if (status === "failure") return DesktopActivityLogStatus.DesktopActivityLogFailure
  if (status === "warning") return DesktopActivityLogStatus.DesktopActivityLogWarning
  return DesktopActivityLogStatus.DesktopActivityLogSuccess
}

export function mapDesktopActivityLogStatus(status: DesktopActivityLogStatus): WorkspaceActivityLogStatus {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure) return "failure"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning) return "warning"
  return "success"
}

export function mapActivityLogItem(item: DesktopActivityLogItem) {
  return {
    id: item.id,
    action: item.action,
    resource: item.resource,
    status: mapDesktopActivityLogStatus(item.status),
    serverId: item.serverId,
    durationMs: item.durationMs,
    detail: item.detail,
    createdAt: item.createdAt,
  }
}

function mapNumberRecord(record?: Record<string, number | undefined>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "number") {
      result[key] = value
    }
  }
  return result
}

export function createDesktopActivityLogAdapter(): SshWorkspaceActivityLogAdapter {
  return {
    async list(params) {
      const result = await ActivityLogService.List({
        page: params?.page,
        limit: params?.limit,
        action: params?.action,
        serverId: params?.serverId,
        status: params?.status ? mapActivityLogStatus(params.status) : undefined,
        startDate: params?.startDate,
        endDate: params?.endDate,
      })

      return {
        items: (result.items || []).map(mapActivityLogItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      }
    },
    async getById(id) {
      return mapActivityLogItem(await ActivityLogService.GetById(id))
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
      return mapActivityLogItem(await ActivityLogService.Record({
        action: input.action,
        resource: input.resource,
        status: mapActivityLogStatus(input.status),
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
