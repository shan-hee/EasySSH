/**
 * Docker 管理 API 封装
 */
import { connectedSSH } from "@/lib/secure-runtime/terminal"
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

export type DockerApiClient = WorkspaceDockerApi

/**
 * Docker API 服务
 */
export const dockerApi: DockerApiClient = {
 listContainers: (id, all = true) => connectedSSH(id).request("docker_containers", { all }),
 getContainerStats: (id) => connectedSSH(id).request("docker_stats"),
 getContainerStat: (id, container) => connectedSSH(id).request("docker_stat", { container }),
 getContainerLogs: (id, container, tail = 100) => connectedSSH(id).request("docker_logs", { container, tail }),
 startContainer: (id, container) => connectedSSH(id).request("docker_start", { container }),
 stopContainer: (id, container) => connectedSSH(id).request("docker_stop", { container }),
 restartContainer: (id, container) => connectedSSH(id).request("docker_restart", { container }),
 pauseContainer: (id, container) => connectedSSH(id).request("docker_pause", { container }),
 unpauseContainer: (id, container) => connectedSSH(id).request("docker_unpause", { container }),
 removeContainer: (id, container, force = false) => connectedSSH(id).request("docker_remove", { container, force }),
 listImages: (id) => connectedSSH(id).request("docker_images"),
 getSystemInfo: (id) => connectedSSH(id).request("docker_system"),
 getResources: (id) => connectedSSH(id).request("docker_resources"),
 checkImageUpdate: (id, container) => connectedSSH(id).request("docker_check_update", { container }),
}
