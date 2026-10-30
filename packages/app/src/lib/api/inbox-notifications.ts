import { apiFetch } from "@/lib/api-client"

export interface InboxNotification {
  id: string
  event_type: string
  severity: "info" | "success" | "warning" | "error"
  title: string
  message: string
  source_type?: string
  source_id?: string
  action_url?: string
  data_json?: string
  read_at?: string
  created_at: string
}

export interface InboxNotificationListResponse {
  notifications: InboxNotification[]
  unread_count: number
  total: number
  page: number
  page_size: number
  total_pages: number
}

export const inboxNotificationsApi = {
  list(params: { unread?: boolean; page?: number; page_size?: number } = {}) {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value))
    })
    return apiFetch<InboxNotificationListResponse>(`/notifications${query.size ? `?${query}` : ""}`)
  },
  markRead(id: string) {
    return apiFetch(`/notifications/${id}/read`, { method: "POST" })
  },
  markAllRead() {
    return apiFetch("/notifications/read-all", { method: "POST" })
  },
  remove(id: string) {
    return apiFetch(`/notifications/${id}`, { method: "DELETE" })
  },
  clearRead() {
    return apiFetch("/notifications/read", { method: "DELETE" })
  },
}
