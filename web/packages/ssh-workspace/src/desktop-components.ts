import { createElement, type ComponentProps } from "react"

import { LogsClient as BaseLogsClient } from "../../../src/components/logs/logs-client"
import BaseScriptsPage from "../../../src/components/dashboard/scripts/scripts-page"
import { BackupRestoreTab as BaseBackupRestoreTab } from "../../../src/components/settings/backup-restore-tab"

export type LogsClientProps = ComponentProps<typeof BaseLogsClient>
export type ScriptsPageProps = ComponentProps<typeof BaseScriptsPage>
export type BackupRestoreTabProps = ComponentProps<typeof BaseBackupRestoreTab>

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

  return createElement(BaseScriptsPage, {
    ...props,
    desktopMode: true,
    executionRedirectPath: null,
  })
}

export function BackupRestoreTab(props: BackupRestoreTabProps = {}) {
  if (!props.adapter) {
    throw new Error("Desktop BackupRestoreTab requires a desktop backup adapter")
  }

  return createElement(BaseBackupRestoreTab, {
    ...props,
    desktopMode: true,
  })
}
