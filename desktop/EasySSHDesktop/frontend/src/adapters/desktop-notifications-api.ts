import { DesktopNotificationService } from "../../bindings/github.com/easyssh/easyssh-desktop"

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

export const desktopNotificationsApi = {
  list(limit = 40) {
    return DesktopNotificationService.List(limit) as Promise<DesktopNotificationList>
  },
  markRead(id: string) {
    return DesktopNotificationService.MarkRead(id) as Promise<void>
  },
  markAllRead() {
    return DesktopNotificationService.MarkAllRead() as Promise<void>
  },
  remove(id: string) {
    return DesktopNotificationService.Delete(id) as Promise<void>
  },
}
