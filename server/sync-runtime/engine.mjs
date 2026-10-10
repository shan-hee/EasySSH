import * as A from '@automerge/automerge'
import { createInterface } from 'node:readline'
import { createEngine } from '../../shared/syncjs/document.mjs'

const engine = createEngine(A)
// No listening socket: the Go parent is the only caller, through stdio.
function handle(request) {
  let doc = engine.load(request.document)
  try {
    doc = engine.reconcile(doc, request.current)
    const peer = request.peer || {}
    doc = engine.receive(doc, peer)
    if (request.resolution) {
      const { key, field, value } = request.resolution
      doc = engine.resolve(doc, key, field, value)
    }
    let response
    try {
      response = engine.outgoing(doc, peer.heads || [])
    } catch {
      response = engine.outgoing(doc, [])
    }
    return { document: engine.save(doc), ...engine.project(doc), response }
  } finally {
    engine.free(doc)
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  try {
    process.stdout.write(JSON.stringify({ result: handle(JSON.parse(line)) }) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message }) + '\n')
  }
}
