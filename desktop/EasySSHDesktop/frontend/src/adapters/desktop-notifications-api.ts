import { Call } from "@wailsio/runtime"

export interface DesktopNotification {
  id: string
  event_type: string
  severity: "info" | "success" | "warning" | "error"
  title: string
  message: string
  action_url?: string
  read_at?: string
  created_at: string
}

export interface DesktopNotificationList {
  notifications: DesktopNotification[]
  unread_count: number
}

const serviceName = "github.com/easyssh/easyssh-desktop.DesktopNotificationService"

export const desktopNotificationsApi = {
  list(limit = 40) {
    return Call.ByName(`${serviceName}.List`, limit) as Promise<DesktopNotificationList>
  },
  markRead(id: string) {
    return Call.ByName(`${serviceName}.MarkRead`, id) as Promise<void>
  },
  markAllRead() {
    return Call.ByName(`${serviceName}.MarkAllRead`) as Promise<void>
  },
  remove(id: string) {
    return Call.ByName(`${serviceName}.Delete`, id) as Promise<void>
  },
}
