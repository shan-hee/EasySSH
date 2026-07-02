import type {
  SshWorkspaceApiClient,
  WorkspaceDockerContainer,
  WorkspaceDockerContainerState,
  WorkspaceDockerContainerStats,
  WorkspaceDockerImage,
  WorkspaceDockerPort,
  WorkspaceDockerResourcesResponse,
  WorkspaceDockerSystemInfo,
} from "@easyssh/ssh-workspace/desktop"
import { DesktopDockerService } from "../../bindings/github.com/easyssh/easyssh-desktop"

type DesktopDockerApi = NonNullable<SshWorkspaceApiClient["docker"]>
type DesktopDockerContainerModel = Awaited<ReturnType<typeof DesktopDockerService.ListContainers>>["data"][number]
type DesktopDockerImageModel = Awaited<ReturnType<typeof DesktopDockerService.ListImages>>["data"][number]
type DesktopDockerStatsModel = Awaited<ReturnType<typeof DesktopDockerService.GetContainerStats>>[number]
type DesktopDockerSystemInfoModel = Awaited<ReturnType<typeof DesktopDockerService.GetSystemInfo>>

const validContainerStates = new Set<WorkspaceDockerContainerState>([
  "running",
  "paused",
  "exited",
  "created",
  "restarting",
  "dead",
])

export function createDesktopDockerApi(): DesktopDockerApi {
  return {
    async listContainers(serverId, all = true) {
      const result = await DesktopDockerService.ListContainers({ serverId, all })
      const data = (result.data || []).map(mapContainer)
      return {
        data,
        total: Number(result.total) || data.length,
      }
    },
    async getContainerStats(serverId) {
      return (await DesktopDockerService.GetContainerStats({ serverId })).map(mapStats)
    },
    async getContainerStat(serverId, containerId) {
      return mapStats(await DesktopDockerService.GetContainerStat({ serverId, containerId }))
    },
    async getContainerLogs(serverId, containerId, tail = 100, encoding = "utf-8") {
      const result = await DesktopDockerService.GetContainerLogs({ serverId, containerId, tail, encoding })
      return {
        data: result.data || "",
        container_id: result.container_id || containerId,
        lines: Number(result.lines) || tail,
      }
    },
    async startContainer(serverId, containerId) {
      await DesktopDockerService.StartContainer({ serverId, containerId })
    },
    async stopContainer(serverId, containerId) {
      await DesktopDockerService.StopContainer({ serverId, containerId })
    },
    async restartContainer(serverId, containerId) {
      await DesktopDockerService.RestartContainer({ serverId, containerId })
    },
    async pauseContainer(serverId, containerId) {
      await DesktopDockerService.PauseContainer({ serverId, containerId })
    },
    async unpauseContainer(serverId, containerId) {
      await DesktopDockerService.UnpauseContainer({ serverId, containerId })
    },
    async removeContainer(serverId, containerId, force = false) {
      await DesktopDockerService.RemoveContainer({ serverId, containerId, force })
    },
    async listImages(serverId) {
      const result = await DesktopDockerService.ListImages({ serverId })
      const data = (result.data || []).map(mapImage)
      return {
        data,
        total: Number(result.total) || data.length,
      }
    },
    async getSystemInfo(serverId) {
      return mapSystemInfo(await DesktopDockerService.GetSystemInfo({ serverId }))
    },
    async getResources(serverId) {
      const result = await DesktopDockerService.GetResources({ serverId })
      const resourceMeta = result as typeof result & {
        statsTruncated?: boolean
        statsLimit?: number
        runningStatsTotal?: number
      }
      return {
        stats: (result.stats || []).map(mapStats),
        systemInfo: result.systemInfo ? mapSystemInfo(result.systemInfo) : null,
        dockerInstalled: Boolean(result.dockerInstalled),
        statsTruncated: Boolean(resourceMeta.statsTruncated),
        statsLimit: toNumber(resourceMeta.statsLimit),
        runningStatsTotal: toNumber(resourceMeta.runningStatsTotal),
        error: result.error,
      } satisfies WorkspaceDockerResourcesResponse
    },
    async checkImageUpdate(serverId, containerId) {
      const result = await DesktopDockerService.CheckImageUpdate({ serverId, containerId })
      return {
        hasUpdate: Boolean(result.hasUpdate),
        imageName: result.imageName || "",
        containerName: result.containerName || "",
        updateCommand: result.updateCommand || "",
        error: result.error,
      }
    },
  }
}

function mapContainer(container: DesktopDockerContainerModel): WorkspaceDockerContainer {
  return {
    id: container.id || "",
    names: container.names || [],
    image: container.image || "",
    imageId: container.imageId || "",
    command: container.command || "",
    created: toNumber(container.created),
    status: container.status || "",
    state: normalizeContainerState(container.state),
    ports: (container.ports || []).map(mapPort),
    labels: normalizeLabels(container.labels),
    mounts: (container.mounts || []).map((mount) => ({
      type: mount.type || "",
      source: mount.source || "",
      destination: mount.destination || "",
      mode: mount.mode || "",
      rw: Boolean(mount.rw),
    })),
  }
}

function mapPort(port: DesktopDockerContainerModel["ports"][number]): WorkspaceDockerPort {
  return {
    ip: port.ip || undefined,
    privatePort: toNumber(port.privatePort),
    publicPort: port.publicPort ? toNumber(port.publicPort) : undefined,
    type: port.type === "udp" ? "udp" : "tcp",
  }
}

function mapImage(image: DesktopDockerImageModel): WorkspaceDockerImage {
  return {
    id: image.id || "",
    repository: image.repository || "",
    tag: image.tag || "",
    created: toNumber(image.created),
    size: toNumber(image.size),
    virtualSize: toNumber(image.virtualSize),
  }
}

function mapStats(stats: DesktopDockerStatsModel): WorkspaceDockerContainerStats {
  return {
    containerId: stats.containerId || "",
    name: stats.name || "",
    cpuPercent: toNumber(stats.cpuPercent),
    memoryUsage: toNumber(stats.memoryUsage),
    memoryLimit: toNumber(stats.memoryLimit),
    memoryPercent: toNumber(stats.memoryPercent),
    networkIn: toNumber(stats.networkIn),
    networkOut: toNumber(stats.networkOut),
    blockRead: toNumber(stats.blockRead),
    blockWrite: toNumber(stats.blockWrite),
    pids: toNumber(stats.pids),
  }
}

function mapSystemInfo(info: DesktopDockerSystemInfoModel): WorkspaceDockerSystemInfo {
  return {
    containersRunning: toNumber(info.containersRunning),
    containersPaused: toNumber(info.containersPaused),
    containersStopped: toNumber(info.containersStopped),
    containersTotal: toNumber(info.containersTotal),
    imagesCount: toNumber(info.imagesCount),
    dockerVersion: info.dockerVersion || info.serverVersion || "",
    serverVersion: info.serverVersion || info.dockerVersion || "",
    storageDriver: info.storageDriver || "",
    totalMemory: toNumber(info.totalMemory),
    cpus: toNumber(info.cpus),
  }
}

function normalizeContainerState(value: string): WorkspaceDockerContainerState {
  const state = value.toLowerCase() as WorkspaceDockerContainerState
  return validContainerStates.has(state) ? state : "exited"
}

function normalizeLabels(labels: Record<string, string | undefined> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  Object.entries(labels || {}).forEach(([key, value]) => {
    if (typeof value === "string") {
      result[key] = value
    }
  })
  return result
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
