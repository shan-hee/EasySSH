import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as A from "@automerge/automerge"
import { createEngine } from "../../shared/syncjs/document.mjs"

const engine = createEngine(A)
const key = "value/00000000-0000-4000-8000-000000000001"
const refA = "10000000-0000-4000-8000-000000000001"
const refB = "20000000-0000-4000-8000-000000000002"

describe("shared Automerge sync engine", () => {
  it("preserves concurrent first writes until an explicit conflict resolution", () => {
    let left = engine.reconcile(engine.load(""), { [key]: { ref: refA } })
    let right = engine.reconcile(engine.load(""), { [key]: { ref: refB } })
    try {
      left = engine.receive(left, engine.outgoing(right, []))
      let projected = engine.project(left)
      assert.equal(projected.conflicts.length, 1)
      assert.deepEqual(new Set(projected.conflicts[0].values), new Set([refA, refB]))
      left = engine.reconcile(left, projected.snapshot)
      projected = engine.project(left)
      assert.equal(projected.conflicts.length, 1)
      left = engine.resolve(left, key, "ref", refB)
      right = engine.receive(right, engine.outgoing(left, []))
      assert.deepEqual(engine.project(right), { snapshot: { [key]: { ref: refB } }, conflicts: [] })
    } finally {
      engine.free(left)
      engine.free(right)
    }
  })

  it("merges independent edits incrementally without generating no-op changes", () => {
    const scriptKey = "script/00000000-0000-4000-8000-000000000001"
    const original = { name: "original", content: "echo one" }
    const base = engine.reconcile(engine.load(""), { [scriptKey]: original })
    let left = engine.load(engine.save(base))
    let right = engine.load(engine.save(base))
    try {
      left = engine.reconcile(left, { [scriptKey]: { ...original, name: "renamed" } })
      right = engine.reconcile(right, { [scriptKey]: { ...original, content: "echo two" } })
      const peer = engine.outgoing(right, A.getHeads(base))
      assert.equal(peer.document, undefined)
      assert.ok(peer.changes?.length)
      left = engine.receive(left, peer)
      const projected = engine.project(left)
      assert.deepEqual(projected, {
        snapshot: { [scriptKey]: { name: "renamed", content: "echo two" } },
        conflicts: [],
      })
      const heads = A.getHeads(left)
      left = engine.reconcile(left, projected.snapshot)
      assert.deepEqual(A.getHeads(left), heads)
    } finally {
      engine.free(base)
      engine.free(left)
      engine.free(right)
    }
  })

  it("keeps a concurrent deletion from being resurrected by an edit", () => {
    const base = engine.reconcile(engine.load(""), { [key]: { ref: refA } })
    let left = engine.load(engine.save(base))
    let right = engine.load(engine.save(base))
    try {
      left = engine.reconcile(left, {})
      right = engine.reconcile(right, { [key]: { ref: refB } })
      left = engine.receive(left, engine.outgoing(right, []))
      assert.deepEqual(engine.project(left).snapshot, {})
    } finally {
      engine.free(base)
      engine.free(left)
      engine.free(right)
    }
  })
})
