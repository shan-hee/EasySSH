import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as A from "@automerge/automerge"
import { createEngine } from "../../shared/syncjs/document.mjs"

const engine = createEngine(A)
const key = "value/00000000-0000-4000-8000-000000000001"
const refA = "10000000-0000-4000-8000-000000000001"
const refB = "20000000-0000-4000-8000-000000000002"
const orderKey = "order/00000000-0000-4000-8000-000000000001"
const members = { [`server/${refA}`]: { name: "a" }, [`server/${refB}`]: { name: "b" } }

describe("shared Automerge sync engine", () => {
  it("inherits server ordering on first sync without publishing an empty reorder", () => {
    const order = JSON.stringify([refB, refA])
    let server = engine.reconcile(engine.load(""), { ...members, [orderKey]: { ids: order } })
    let desktop = engine.reconcile(engine.load(""), { [orderKey]: { ids: "[]" } })
    try {
      assert.equal(engine.project(desktop).snapshot[orderKey], undefined)
      server = engine.receive(server, engine.outgoing(desktop, []))
      desktop = engine.receive(desktop, engine.outgoing(server, []))
      assert.equal(engine.project(desktop).snapshot[orderKey].ids, order)
      assert.deepEqual(engine.project(desktop).conflicts, [])
      assert.deepEqual(engine.project(server).conflicts, [])
    } finally { engine.free(server); engine.free(desktop) }
  })

  it("does not report different histories with the same effective server order", () => {
    const deleted = "30000000-0000-4000-8000-000000000003"
    let left = engine.reconcile(engine.load(""), { ...members, [orderKey]: { ids: JSON.stringify([refB, deleted, refA]) } })
    const right = engine.reconcile(engine.load(""), { ...members, [orderKey]: { ids: JSON.stringify([refB, refA]) } })
    try {
      left = engine.receive(left, engine.outgoing(right, []))
      assert.deepEqual(engine.project(left).conflicts, [])
    } finally { engine.free(left); engine.free(right) }
  })

  it("keeps conflicting business fields unchanged until explicit resolution across repeated syncs", () => {
    const script = "script/00000000-0000-4000-8000-000000000003"
    const initial = { name: "script", content: "echo base" }
    const base = engine.reconcile(engine.load(""), { [script]: initial })
    const current = { [script]: { ...initial, content: "echo local" } }
    let left = engine.reconcile(engine.load(engine.save(base)), current)
    const right = engine.reconcile(engine.load(engine.save(base)), { [script]: { ...initial, name: "renamed", content: "echo remote" } })
    try {
      left = engine.receive(left, engine.outgoing(right, []))
      let applied = engine.projectConfiguration(left, current)
      assert.equal(applied.snapshot[script].content, "echo local")
      assert.equal(applied.snapshot[script].name, "renamed")
      assert.equal(applied.conflicts.length, 1)
      for (let i = 0; i < 3; i++) {
        left = engine.reconcile(left, applied.snapshot)
        applied = engine.projectConfiguration(left, applied.snapshot)
        assert.equal(applied.conflicts.length, 1)
        assert.equal(applied.snapshot[script].content, "echo local")
      }
      const fresh = engine.projectConfiguration(left, {})
      assert.equal(fresh.snapshot[script], undefined)
      left = engine.reconcile(left, fresh.snapshot)
      assert.equal(engine.project(left).conflicts.length, 1)
      left = engine.resolve(left, script, "content", "echo remote")
      applied = engine.projectConfiguration(left, current)
      assert.equal(applied.snapshot[script].content, "echo remote")
      assert.deepEqual(applied.conflicts, [])
    } finally { engine.free(base); engine.free(left); engine.free(right) }
  })

  it("keeps whole-order conflicts after membership projection until explicitly resolved", () => {
    const orderKey = "order/00000000-0000-4000-8000-000000000001"
    const removed = "30000000-0000-4000-8000-000000000003"
    const orderA = JSON.stringify([refA, removed, refB])
    const orderB = JSON.stringify([refB, refA, removed])
    let left = engine.reconcile(engine.load(""), { ...members, [orderKey]: { ids: orderA } })
    let right = engine.reconcile(engine.load(""), { ...members, [orderKey]: { ids: orderB } })
    try {
      left = engine.receive(left, engine.outgoing(right, []))
      let projected = engine.project(left)
      assert.equal(projected.conflicts.length, 1)
      assert.deepEqual(new Set(projected.conflicts[0].values), new Set([orderA, orderB]))
      // The local database no longer contains the deleted server. Its filtered
      // order must not erase the two unresolved user decisions on the next sync.
      const localOrder = JSON.parse(projected.snapshot[orderKey].ids).filter((id: string) => id !== removed)
      left = engine.reconcile(left, { ...members, [orderKey]: { ids: JSON.stringify(localOrder) } })
      projected = engine.project(left)
      assert.equal(projected.conflicts.length, 1)
      const kept = engine.projectConfiguration(left, { ...members, [orderKey]: { ids: JSON.stringify([refA, refB]) } })
      assert.equal(kept.snapshot[orderKey].ids, JSON.stringify([refA, refB]))
      left = engine.resolve(left, orderKey, "ids", orderB)
      right = engine.receive(right, engine.outgoing(left, []))
      assert.equal(engine.project(right).conflicts.length, 0)
      assert.equal(engine.project(right).snapshot[orderKey].ids, orderB)
    } finally {
      engine.free(left)
      engine.free(right)
    }
  })

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
