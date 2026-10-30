import { describe, it } from "node:test"
import assert from "node:assert/strict"

import type { TransferJob } from "../src/lib/transfer-job-types"
import {
  createFileTransferController,
  type FileTransferSftpApi,
} from "../src/lib/session/transfer-manager-controller"
import type { WorkspaceTransferTask } from "../src/lib/session/workspace"
import { createTransferConcurrencyLimiter } from "../src/lib/session/transfer-runtime"

describe("createFileTransferController", () => {
  it("follows a host-assigned task ID until the relay completes", async () => {
    const jobs = new Map<string, TransferJob>()
    const harness = createHarness({
      async directTransfer(_sourceServerId, _sourcePath, _targetServerId, _targetPath, { taskId, onStarted }) {
        // 桌面以调用方生成的 ID 落库，并在返回前完成传输。
        onStarted(taskId)
        jobs.set(taskId, job({ id: taskId, kind: "sftp_transfer", status: "completed", progress: 100 }))
      },
      async getTransfer(id) {
        const current = jobs.get(id)
        if (!current) throw new Error("not found")
        return current
      },
    })

    await harness.controller.directTransfer("source", "/srv/app.tar.gz", "target", "/tmp", "source", "target", "app.tar.gz")

    assert.equal(harness.tasks.length, 1)
    assert.equal(harness.tasks[0]?.status, "completed")
    assert.equal(harness.tasks[0]?.progress, 100)
    assert.ok(jobs.has(harness.tasks[0]!.id))
  })

  it("delivers the artifact once a server download job completes", async () => {
    const delivered: string[] = []
    let reads = 0
    const harness = createHarness({
      async downloadFile(_serverId, _path, { onStarted }) {
        onStarted("server-job")
      },
      async getTransfer(id) {
        reads += 1
        return job({ id, kind: "sftp_download", status: reads < 2 ? "running" : "completed", artifact_name: "logs.tar.gz" })
      },
      async deliverArtifact(completed) {
        delivered.push(completed.artifact_name)
      },
    })

    await harness.controller.downloadFile("server", "/var/log", "log")

    assert.deepEqual(delivered, ["logs.tar.gz"])
    assert.equal(harness.tasks[0]?.status, "completed")
  })

  it("marks a failed job and rejects with its reason", async () => {
    const harness = createHarness({
      async uploadFile(_serverId, _path, _file, { onStarted }) {
        onStarted("upload-job")
      },
      async getTransfer(id) {
        return job({ id, kind: "sftp_upload", status: "failed", error_message: "disk full" })
      },
    })

    await assert.rejects(
      harness.controller.uploadFile("server", "/tmp", new File(["data"], "a.txt")),
      /disk full/,
    )
    assert.equal(harness.tasks[0]?.status, "failed")
    assert.equal(harness.tasks[0]?.error, "disk full")
  })

  it("cancels the server job of a running transfer", async () => {
    const cancelled: string[] = []
    let started!: () => void
    const startedOnce = new Promise<void>((resolve) => { started = resolve })
    const harness = createHarness({
      async downloadFile(_serverId, _path, { onStarted }) {
        onStarted("running-job")
        started()
      },
      async getTransfer(id) {
        return job({ id, kind: "sftp_download", status: "running" })
      },
      async cancelTransfer(id) {
        cancelled.push(id)
      },
    })

    const download = harness.controller.downloadFile("server", "/data", "data")
    await startedOnce
    harness.controller.cancelTask(harness.tasks[0]!.id)
    await download

    assert.deepEqual(cancelled, ["running-job"])
    assert.equal(harness.tasks[0]?.status, "cancelled")
  })
})

function createHarness(overrides: Partial<FileTransferSftpApi>) {
  const harness = { tasks: [] as WorkspaceTransferTask[] }
  const unavailable = () => Promise.reject(new Error("unexpected call"))
  const api: FileTransferSftpApi = {
    getTransfer: unavailable,
    listTransfers: async () => [],
    cancelTransfer: async () => undefined,
    uploadFile: unavailable,
    downloadFile: unavailable,
    batchDownload: unavailable,
    directTransfer: unavailable,
    ...overrides,
  }
  const controller = createFileTransferController({
    api,
    uploadLimiter: createTransferConcurrencyLimiter(),
    getTasks: () => harness.tasks,
    setTasks: (updater) => {
      harness.tasks = updater(harness.tasks)
    },
    pollIntervalMs: 1,
  })
  return Object.assign(harness, { controller })
}

function job(overrides: Partial<TransferJob> & Pick<TransferJob, "id" | "kind" | "status">): TransferJob {
  return {
    actor: { kind: "owner", id: "owner", session_id: "session" },
    name: "",
    runner: "server",
    stage: "staging",
    description: "",
    source_path: "",
    target_path: "",
    file_name: "",
    artifact_name: "",
    artifact_managed: false,
    artifact_size: 0,
    bytes_total: 0,
    bytes_processed: 0,
    bytes_completed: 0,
    files_total: 0,
    files_completed: 0,
    result_path: "",
    speed_bps: 0,
    progress: 0,
    retry_count: 0,
    max_retries: 0,
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-30T00:00:00Z",
    ...overrides,
  }
}
