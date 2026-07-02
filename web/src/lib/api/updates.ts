import { apiFetch } from "@/lib/api-client"

export interface WebUpdateInstructions {
  docker_image?: string
  docker_compose?: string
  docker_compose_file?: string
}

export interface UpdateCheckResult {
  current_version: string
  latest_version: string
  has_update: boolean
  target: "web"
  release_url?: string
  published_at?: string
  notes?: string
  instructions?: WebUpdateInstructions
}

export const updatesApi = {
  async checkWeb(): Promise<UpdateCheckResult> {
    const params = new URLSearchParams({ target: "web" })
    return apiFetch<UpdateCheckResult>(`/updates/check?${params.toString()}`, {
      method: "GET",
      retry: false,
      timeout: 15000,
    })
  },
}
