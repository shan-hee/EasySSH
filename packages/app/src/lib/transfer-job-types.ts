import type { components } from "@/generated/openapi"

export type TransferJob = components["schemas"]["TransferJob"]
export type TransferJobKind = TransferJob["kind"]
export type TransferJobStatus = TransferJob["status"]
export type TransferJobStage = TransferJob["stage"]
export type TransferJobListResponse = components["schemas"]["TransferJobList"]
export type TransferJobStatistics = components["schemas"]["TransferStatistics"]

/** 仍在进行、需要继续观察的状态。 */
export const ACTIVE_TRANSFER_JOB_STATUSES: ReadonlySet<TransferJobStatus> = new Set([
  "created",
  "staging",
  "queued",
  "running",
  "canceling",
])

export function isTransferJobSettled(job: Pick<TransferJob, "status">): boolean {
  return !ACTIVE_TRANSFER_JOB_STATUSES.has(job.status)
}
