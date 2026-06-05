import { Call as $Call, type CancellablePromise as $CancellablePromise } from "@wailsio/runtime"

import type * as $models from "./models.js"

const service = "github.com/easyssh/easyssh-desktop.ActivityLogService"

export function List(params: $models.DesktopActivityLogListParams): $CancellablePromise<$models.DesktopActivityLogListResult> {
  return $Call.ByName(`${service}.List`, params)
}

export function GetById(id: string): $CancellablePromise<$models.DesktopActivityLogItem> {
  return $Call.ByName(`${service}.GetById`, id)
}

export function GetStatistics(params: $models.DesktopActivityLogListParams): $CancellablePromise<$models.DesktopActivityLogStatistics> {
  return $Call.ByName(`${service}.GetStatistics`, params)
}

export function Record(input: $models.DesktopActivityLogRecordInput): $CancellablePromise<$models.DesktopActivityLogItem> {
  return $Call.ByName(`${service}.Record`, input)
}

export function Clear(before: string): $CancellablePromise<number> {
  return $Call.ByName(`${service}.Clear`, before)
}
