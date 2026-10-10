import * as A from "@automerge/automerge/slim"
import wasm from "@automerge/automerge/automerge.wasm?url"
import { createEngine } from "../../../../shared/syncjs/document.mjs"

// Explicit initialization works in Vite and WebView2 without a WASM plugin.
await A.initializeWasm(
  fetch(wasm)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load sync engine: HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then((buffer) => new Uint8Array(buffer)),
)
const engine = createEngine(A)
export const freeDocument = engine.free
export const loadDocument = engine.load
export const saveDocument = engine.save
export const projectDocument = engine.project
export const reconcileDocument = engine.reconcile
export const outgoing = engine.outgoing
export const receive = engine.receive
export const resolveConflict = engine.resolve
export type { SyncSnapshot, SyncPeer, SyncDoc } from "../../../../shared/syncjs/document.mjs"
