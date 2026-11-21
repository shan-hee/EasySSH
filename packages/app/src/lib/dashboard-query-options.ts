import { keepPreviousData, queryOptions } from "@tanstack/react-query"

import type { scriptsApi } from "@/lib/api"
import { dashboardApi } from "@/lib/api/dashboard"
import type { logsApi } from "@/lib/api/logs"
import {
  operationRecordsApi,
  type OperationRecordListParams,
} from "@/lib/api/operation-records"
import { settingsApi } from "@/lib/api/settings"
import type {
  TaskCenterApi,
  TaskRunListParams,
} from "@/components/task-center/task-center-contracts"
import type { AuditLogListParams } from "@/lib/log-types"
import { queryKeys } from "@/lib/query-keys"
import { DEFAULT_TABLE_PAGE_SIZE } from "@/lib/table-pagination"

export function dashboardOverviewQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.dashboard.overview,
    queryFn: () => dashboardApi.getOverview(),
    staleTime: 60_000,
  })
}

export function scriptsListQueryOptions(
  page = 1,
  pageSize = DEFAULT_TABLE_PAGE_SIZE,
  client: Pick<typeof scriptsApi, "list">,
) {
  return queryOptions({
    queryKey: queryKeys.scripts.list(page, pageSize),
    queryFn: () => client.list({ page, limit: pageSize }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export const defaultAuditLogListParams: AuditLogListParams = {
  page: 1,
  page_size: DEFAULT_TABLE_PAGE_SIZE,
  sort_by: "created_at",
  sort_order: "desc",
}

export function auditLogsQueryOptions(
  params: AuditLogListParams = defaultAuditLogListParams,
  client: Pick<typeof logsApi, "list">,
) {
  return queryOptions({
    queryKey: queryKeys.logs.audit(params),
    queryFn: () => client.list(params),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export const defaultOperationRecordListParams: OperationRecordListParams = {
  page: 1,
  page_size: DEFAULT_TABLE_PAGE_SIZE,
  sort_by: "created_at",
  sort_order: "desc",
}

export function operationRecordsQueryOptions(
  params: OperationRecordListParams = defaultOperationRecordListParams,
) {
  return queryOptions({
    queryKey: queryKeys.logs.operations(params),
    queryFn: () => operationRecordsApi.list(params),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export async function loadSystemBasicSettings() {
  const data = await settingsApi.getSystemConfig()
  return {
    system_name: data.system_name,
    system_logo: data.system_logo,
    system_favicon: data.system_favicon,
    default_language: data.default_language,
    default_timezone: data.default_timezone,
    date_format: data.date_format,
  }
}

export const defaultTaskCenterListParams: TaskRunListParams = {
  exclude_micro: true,
  page: 1,
  page_size: DEFAULT_TABLE_PAGE_SIZE,
}

export function taskCenterRunsQueryOptions(
  params: TaskRunListParams = defaultTaskCenterListParams,
  client: Pick<TaskCenterApi, "list">,
) {
  return queryOptions({
    queryKey: queryKeys.taskCenter.runs(params),
    queryFn: () => client.list(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function taskCenterStatisticsQueryOptions(
  client: Pick<TaskCenterApi, "statistics">,
) {
  return queryOptions({
    queryKey: queryKeys.taskCenter.statistics,
    queryFn: client.statistics,
    staleTime: 30_000,
  })
}
