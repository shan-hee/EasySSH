import { createElement, type ComponentProps, type ComponentType } from "react"

import { LogsClient as BaseLogsClient } from "../../../src/components/logs/logs-client"
import BaseScriptsPage from "../../../src/components/dashboard/scripts/scripts-page"
import { BackupRestoreTab as BaseBackupRestoreTab } from "../../../src/components/settings/backup-restore-tab"

export type LogsClientProps = ComponentProps<typeof BaseLogsClient>
export type ScriptsPageProps = NonNullable<ComponentProps<typeof BaseScriptsPage>>
export type BackupRestoreTabProps = NonNullable<ComponentProps<typeof BaseBackupRestoreTab>>

const DesktopScriptsPage = BaseScriptsPage as ComponentType<ScriptsPageProps>
const DesktopBackupRestoreTab = BaseBackupRestoreTab as ComponentType<BackupRestoreTabProps>

export function LogsClient(props: LogsClientProps) {
  if (!props.api) {
    throw new Error("Desktop LogsClient requires a desktop logs api adapter")
  }

  return createElement(BaseLogsClient, {
    ...props,
    desktopMode: true,
  })
}

export function ScriptsPage(props: ScriptsPageProps = {}) {
  const adapters = props.adapters
  if (!adapters || !adapters.scripts || !adapters.servers || !adapters.batchTasks) {
    throw new Error("Desktop ScriptsPage requires desktop script, server, and batch task adapters")
  }

  return createElement(DesktopScriptsPage, {
    ...props,
    desktopMode: true,
    executionRedirectPath: null,
  })
}

export function BackupRestoreTab(props: BackupRestoreTabProps = {}) {
  if (!props.adapter) {
    throw new Error("Desktop BackupRestoreTab requires a desktop backup adapter")
  }

  return createElement(DesktopBackupRestoreTab, {
    ...props,
    desktopMode: true,
  })
}
