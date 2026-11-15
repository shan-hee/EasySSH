import { createElement, type ComponentProps, type ComponentType } from "react"

import { LogsClient as BaseLogsClient } from "@/components/logs/logs-client"
import BaseScriptsPage from "@/components/dashboard/scripts/scripts-page"
import { BackupRestoreTab as BaseBackupRestoreTab } from "@/components/settings/backup-restore-tab"

export type LogsClientProps = ComponentProps<typeof BaseLogsClient>
export type ScriptsPageProps = NonNullable<ComponentProps<typeof BaseScriptsPage>>
export type BackupRestoreTabProps = NonNullable<ComponentProps<typeof BaseBackupRestoreTab>>

const DesktopScriptsPage = BaseScriptsPage as ComponentType<ScriptsPageProps>
const DesktopBackupRestoreTab = BaseBackupRestoreTab as ComponentType<BackupRestoreTabProps>

export function LogsClient(props: LogsClientProps) {
  return createElement(BaseLogsClient, {
    ...props,
    desktopMode: true,
  })
}

export function ScriptsPage(props: ScriptsPageProps) {
  return createElement(DesktopScriptsPage, {
    ...props,
    desktopMode: true,
    executionRedirectPath: null,
  })
}

export function BackupRestoreTab(props: BackupRestoreTabProps) {
  return createElement(DesktopBackupRestoreTab, {
    ...props,
  })
}
