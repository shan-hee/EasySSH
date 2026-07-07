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
import { toFiniteNumber } from "./desktop-adapter-utils"

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
        statsLimit: toFiniteNumber(resourceMeta.statsLimit),
        runningStatsTotal: toFiniteNumber(resourceMeta.runningStatsTotal),
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
    created: toFiniteNumber(container.created),
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
    privatePort: toFiniteNumber(port.privatePort),
    publicPort: port.publicPort ? toFiniteNumber(port.publicPort) : undefined,
    type: port.type === "udp" ? "udp" : "tcp",
  }
}

function mapImage(image: DesktopDockerImageModel): WorkspaceDockerImage {
  return {
    id: image.id || "",
    repository: image.repository || "",
    tag: image.tag || "",
    created: toFiniteNumber(image.created),
    size: toFiniteNumber(image.size),
    virtualSize: toFiniteNumber(image.virtualSize),
  }
}

function mapStats(stats: DesktopDockerStatsModel): WorkspaceDockerContainerStats {
  return {
    containerId: stats.containerId || "",
    name: stats.name || "",
    cpuPercent: toFiniteNumber(stats.cpuPercent),
    memoryUsage: toFiniteNumber(stats.memoryUsage),
    memoryLimit: toFiniteNumber(stats.memoryLimit),
    memoryPercent: toFiniteNumber(stats.memoryPercent),
    networkIn: toFiniteNumber(stats.networkIn),
    networkOut: toFiniteNumber(stats.networkOut),
    blockRead: toFiniteNumber(stats.blockRead),
    blockWrite: toFiniteNumber(stats.blockWrite),
    pids: toFiniteNumber(stats.pids),
  }
}

function mapSystemInfo(info: DesktopDockerSystemInfoModel): WorkspaceDockerSystemInfo {
  return {
    containersRunning: toFiniteNumber(info.containersRunning),
    containersPaused: toFiniteNumber(info.containersPaused),
    containersStopped: toFiniteNumber(info.containersStopped),
    containersTotal: toFiniteNumber(info.containersTotal),
    imagesCount: toFiniteNumber(info.imagesCount),
    dockerVersion: info.dockerVersion || info.serverVersion || "",
    serverVersion: info.serverVersion || info.dockerVersion || "",
    storageDriver: info.storageDriver || "",
    totalMemory: toFiniteNumber(info.totalMemory),
    cpus: toFiniteNumber(info.cpus),
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
