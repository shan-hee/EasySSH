import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  createFileTransferController,
  type FileTransferSftpApi,
} from "../packages/ssh-workspace/src/session/transfer-manager-controller"
import type { WorkspaceTransferTask } from "../packages/ssh-workspace/src/session/workspace"
import {
  createTransferConcurrencyLimiter,
  createTransferRuntimeHandleStore,
} from "../packages/ssh-workspace/src/session/transfer-runtime"

describe("createFileTransferController", () => {
  it("completes synchronous server transfers without opening a progress socket", async () => {
    let tasks: WorkspaceTransferTask[] = []
    let ticketRequests = 0
    const api = createTransferApi()

    const controller = createFileTransferController({
      api,
      createTicket: async () => {
        ticketRequests++
        return { ticket: "unused" }
      },
      resolveWebSocketUrl: () => {
        throw new Error("progress socket should not be used")
      },
      uploadLimiter: createTransferConcurrencyLimiter(),
      handles: createTransferRuntimeHandleStore(),
      getTasks: () => tasks,
      setTasks: (updater) => {
        tasks = updater(tasks)
      },
      serverTransferUsesProgressSocket: false,
    })

    await controller.directTransfer(
      "source-server",
      "/srv/app.tar.gz",
      "target-server",
      "/tmp",
      "source",
      "target",
      "app.tar.gz",
    )

    assert.equal(ticketRequests, 0)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.id, "desktop-transfer-1")
    assert.equal(tasks[0]?.status, "completed")
    assert.equal(tasks[0]?.progress, 100)
    assert.equal(tasks[0]?.transferMethod, "sftp")
  })
})

function createTransferApi(): FileTransferSftpApi {
  return {
    async createUploadTask() {
      return { task_id: "upload-unused" }
    },
    async listUploadTasks() {
      return { tasks: [] }
    },
    async cancelUploadTask() {
      return undefined
    },
    async uploadFile() {
      return null
    },
    async directTransfer(sourceServerId, sourcePath, targetServerId, targetPath) {
      assert.equal(sourceServerId, "source-server")
      assert.equal(sourcePath, "/srv/app.tar.gz")
      assert.equal(targetServerId, "target-server")
      assert.equal(targetPath, "/tmp")
      return {
        success: true,
        task_id: "desktop-transfer-1",
        message: "done",
      }
    },
    async cancelTransfer() {
      return undefined
    },
  }
}
