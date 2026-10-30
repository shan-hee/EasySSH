import { apiFetch } from "@/lib/api-client"
import { connectionHeader, withServerConnection } from "@/lib/api/connections"
import type { SystemInfoApi, SystemSnapshot } from "@/lib/system-info"

export const systemInfoApi: SystemInfoApi = {
  snapshot: (serverId, kind) => withServerConnection(serverId, "monitor", (connectionId) => (
    apiFetch<SystemSnapshot>(`/system/${encodeURIComponent(serverId)}/${kind}`, { headers: connectionHeader(connectionId) })
  )),
}
