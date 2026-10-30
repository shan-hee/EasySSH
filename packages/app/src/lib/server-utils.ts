import type { Server, ServerListParams, ServerListResponse } from "@/lib/server-types"

/** 选择器需要完整列表；按服务端每页最多 100 条的限制读取。 */
export async function loadAllServers(
  list: (params: ServerListParams) => Promise<ServerListResponse>,
): Promise<Server[]> {
  const servers: Server[] = []
  for (let page = 1; ; page++) {
    const result = await list({ page, limit: 100 })
    servers.push(...result.data)
    if (result.data.length === 0 || servers.length >= result.total) return servers
  }
}

/**
 * 获取服务器显示名称
 * 如果 name 为空，返回 username@host:port 格式
 */
export function getServerDisplayName(server: Server): string {
  if (server.name && server.name.trim()) {
    return server.name
  }
  return `${server.username}@${server.host}:${server.port}`
}

/**
 * 获取服务器简短显示名称
 * 如果 name 为空，返回 host
 */
export function getServerShortName(server: Server): string {
  if (server.name && server.name.trim()) {
    return server.name
  }
  return server.host
}
