import { apiFetch } from "@/lib/api-client"
import type { SystemInfoApi, SystemSnapshot } from "@/lib/system-info"

export const systemInfoApi: SystemInfoApi = {
  snapshot: (serverId, kind) => apiFetch<SystemSnapshot>(`/system/${encodeURIComponent(serverId)}/${kind}`),
}
