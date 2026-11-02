import type { NotificationCenterItem, NotificationCenterSource } from "@easyssh/app/components/notification-center"
import { DesktopNotificationService } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"
import { subscribeDesktopTaskEvents } from "./desktop-task-center-api"

export const desktopNotificationSource: NotificationCenterSource = {
  list: () => DesktopNotificationService.List(40) as Promise<{ notifications: NotificationCenterItem[]; unread_count: number }>,
  markRead: (id) => DesktopNotificationService.MarkRead(id),
  markAllRead: () => DesktopNotificationService.MarkAllRead(),
  remove: (id) => DesktopNotificationService.Delete(id),
  clearRead: () => DesktopNotificationService.ClearRead(),
  // 桌面通知随任务完成、清理和恢复写入。
  subscribe: (onChange) => subscribeDesktopTaskEvents((event) => {
    if (event.type === "task.completed" || event.type === "task.cleanup.completed" || event.type === "task.restore.completed") onChange()
  }),
}
