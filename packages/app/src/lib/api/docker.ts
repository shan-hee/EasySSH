/**
 * Docker 管理 API 封装
 */
import { apiFetch } from "@/lib/api-client"
import { connectionHeader, withServerConnection } from "@/lib/api/connections"
import type { components } from "@/generated/openapi"
import type {
  DockerContainer,
  ContainerStats,
  DockerImage,
  DockerSystemInfo,
} from "@/components/terminal/docker/types"
import type { WorkspaceDockerApi } from "@/lib/session/workspace"

/**
 * 容器列表响应
 */
export interface ContainersResponse {
  data: DockerContainer[]
  total: number
}

/**
 * 镜像列表响应
 */
export interface ImagesResponse {
  data: DockerImage[]
  total: number
}

/**
 * 容器日志响应
 */
export interface ContainerLogsResponse {
  data: string
  container_id: string
  lines: number
}

/**
 * 资源页签响应（仅 stats + systemInfo）
 */
export interface ResourcesResponse {
  stats: ContainerStats[]
  systemInfo: DockerSystemInfo | null
  dockerInstalled: boolean
  statsTruncated?: boolean
  statsLimit?: number
  runningStatsTotal?: number
  error?: string
}

/**
 * 镜像更新检查响应
 */
export interface ImageUpdateCheckResponse {
  hasUpdate: boolean
  imageName: string
  containerName: string
  updateCommand: string
  error?: string
}

type DockerActionResult = components["schemas"]["DockerActionResult"]

const DOCKER_ACTION_POLL_MS = 1000
const DOCKER_ACTION_TIMEOUT_MS = 120_000

type ApiFetchOptions = NonNullable<Parameters<typeof apiFetch>[1]>

/** Docker 请求运行在该服务器共享的 Docker 逻辑连接上。 */
function dockerFetch<T>(serverId: string, path: string, options: ApiFetchOptions = {}): Promise<T> {
  return withServerConnection(serverId, "docker", (connectionId) => apiFetch<T>(`/docker/${encodeURIComponent(serverId)}${path}`, {
    ...options,
    headers: { ...options.headers as Record<string, string> | undefined, ...connectionHeader(connectionId) },
  }))
}

/** 容器操作在服务端排队执行，等待结果后再返回，失败时抛出服务端给出的原因。 */
async function runDockerAction(serverId: string, path: string, method: "POST" | "DELETE"): Promise<void> {
  let result = await dockerFetch<DockerActionResult>(serverId, path, { method, retry: false })
  const deadline = Date.now() + DOCKER_ACTION_TIMEOUT_MS
  while (result.status === "queued" || result.status === "running") {
    if (Date.now() >= deadline) throw new Error("Docker action timed out")
    await new Promise((resolve) => setTimeout(resolve, DOCKER_ACTION_POLL_MS))
    result = await dockerFetch<DockerActionResult>(serverId, `/tasks/${encodeURIComponent(result.task_id)}`)
  }
  if (result.status !== "succeeded") {
    throw Object.assign(new Error(result.error_message || `Docker action ${result.status}`), { code: result.error_code })
  }
}

export type DockerApiClient = WorkspaceDockerApi

/**
 * Docker API 服务
 */
export const dockerApi: DockerApiClient = {
  /**
   * 获取容器列表
   */
  async listContainers(serverId: string, all = true): Promise<ContainersResponse> {
    const params = new URLSearchParams()
    if (all) params.set("all", "true")
    const qs = params.toString()
    return dockerFetch<ContainersResponse>(serverId, `/containers${qs ? `?${qs}` : ""}`)
  },

  /**
   * 获取容器统计信息
   */
  async getContainerStats(serverId: string): Promise<ContainerStats[]> {
    const res = await dockerFetch<{ data: ContainerStats[] }>(serverId, "/stats")
    return res.data
  },

  /**
   * 获取单个容器的统计信息
   */
  async getContainerStat(serverId: string, containerId: string): Promise<ContainerStats> {
    return dockerFetch<ContainerStats>(serverId, `/containers/${encodeURIComponent(containerId)}/stats`)
  },

  /**
   * 获取容器日志
   */
  async getContainerLogs(
    serverId: string,
    containerId: string,
    tail = 100,
    encoding = "utf-8"
  ): Promise<ContainerLogsResponse> {
    const params = new URLSearchParams({
      tail: String(tail),
      encoding,
    })

    return dockerFetch<ContainerLogsResponse>(serverId, `/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`)
  },

  /**
   * 启动容器
   */
  async startContainer(serverId: string, containerId: string): Promise<void> {
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}/start`, "POST")
  },

  /**
   * 停止容器
   */
  async stopContainer(serverId: string, containerId: string): Promise<void> {
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}/stop`, "POST")
  },

  /**
   * 重启容器
   */
  async restartContainer(serverId: string, containerId: string): Promise<void> {
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}/restart`, "POST")
  },

  /**
   * 暂停容器
   */
  async pauseContainer(serverId: string, containerId: string): Promise<void> {
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}/pause`, "POST")
  },

  /**
   * 恢复容器
   */
  async unpauseContainer(serverId: string, containerId: string): Promise<void> {
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}/unpause`, "POST")
  },

  /**
   * 删除容器
   */
  async removeContainer(serverId: string, containerId: string, force = false): Promise<void> {
    const params = new URLSearchParams()
    if (force) params.set("force", "true")
    const qs = params.toString()
    await runDockerAction(serverId, `/containers/${encodeURIComponent(containerId)}${qs ? `?${qs}` : ""}`, "DELETE")
  },

  /**
   * 获取镜像列表
   */
  async listImages(serverId: string): Promise<ImagesResponse> {
    return dockerFetch<ImagesResponse>(serverId, "/images")
  },

  /**
   * 获取 Docker 系统信息
   */
  async getSystemInfo(serverId: string): Promise<DockerSystemInfo> {
    const res = await dockerFetch<{ data: DockerSystemInfo }>(serverId, "/system")
    return res.data
  },

  /**
   * 获取资源页签数据（仅 stats + systemInfo）
   */
  async getResources(serverId: string): Promise<ResourcesResponse> {
    return dockerFetch<ResourcesResponse>(serverId, "/resources")
  },

  /**
   * 检查容器镜像更新
   */
  async checkImageUpdate(serverId: string, containerId: string): Promise<ImageUpdateCheckResponse> {
    const res = await dockerFetch<{ data: ImageUpdateCheckResponse }>(serverId, `/containers/${encodeURIComponent(containerId)}/check-update`)
    return res.data
  },
}
