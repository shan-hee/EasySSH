import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createLatestByKeyBatcher,
  mergeLatestByKey,
} from "../src/lib/realtime-batcher"

type Row = { id: string; value: number }

describe("realtime batcher", () => {
  it("keeps only the latest update for the same key", () => {
    const batches: Row[][] = []
    const batcher = createLatestByKeyBatcher<Row, string>({
      keyOf: (row) => row.id,
      onFlush: (rows) => batches.push(rows),
      delayMs: 60_000,
    })

    batcher.enqueue({ id: "server-1", value: 1 })
    batcher.enqueue({ id: "server-1", value: 2 })
    batcher.enqueue({ id: "server-2", value: 3 })
    batcher.flush()

    assert.deepEqual(batches, [[
      { id: "server-1", value: 2 },
      { id: "server-2", value: 3 },
    ]])
    batcher.dispose()
  })

  it("merges successive batches without losing existing rows", () => {
    const first = mergeLatestByKey<Row, string>(
      [{ id: "server-1", value: 1 }],
      [{ id: "server-2", value: 2 }],
      (row) => row.id,
    )
    const second = mergeLatestByKey<Row, string>(
      first,
      [{ id: "server-1", value: 4 }],
      (row) => row.id,
    )

    assert.deepEqual(second, [
      { id: "server-1", value: 4 },
      { id: "server-2", value: 2 },
    ])
  })

  it("does not flush queued work after disposal", () => {
    const batches: Row[][] = []
    const batcher = createLatestByKeyBatcher<Row, string>({
      keyOf: (row) => row.id,
      onFlush: (rows) => batches.push(rows),
      delayMs: 60_000,
    })

    batcher.enqueue({ id: "server-1", value: 1 })
    batcher.dispose()
    batcher.flush()

    assert.deepEqual(batches, [])
  })
})
