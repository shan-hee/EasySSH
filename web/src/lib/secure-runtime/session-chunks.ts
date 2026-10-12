import type { SyncSnapshot } from "@/lib/sync/automerge"
import type { EncryptedWorkspace } from "./workspace"
import { decodeBytes, encodeBytes } from "./browser-ssh"

const valueKey = "value/00000000-0000-4000-8000-000000000001"
const chunkSize = 512 * 1024
const maxSessionBytes = 48 * 1024 * 1024
async function digest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((n) => n.toString(16).padStart(2, "0")).join("")
}

// The small index is the atomic conflict unit. Content-addressed pieces are
// immutable encrypted documents, including all attachment bytes.
export async function packSessions(workspace: EncryptedWorkspace, snapshot: SyncSnapshot): Promise<SyncSnapshot> {
  const index: SyncSnapshot = {}
  for (const [key, record] of Object.entries(snapshot)) {
    const bytes = new TextEncoder().encode(record.content)
    if (bytes.length > maxSessionBytes) throw new Error("单个会话含附件的同步内容超过 48 MiB")
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const piece = bytes.slice(offset, offset + chunkSize), hash = await digest(piece)
      chunks.push(hash)
      const resource = `session-chunk/${hash}`
      if (!(await workspace.snapshot("sessions", resource))[valueKey]) {
        await workspace.edit("sessions", resource, () => ({ [valueKey]: { content: encodeBytes(piece) } }))
      }
    }
    index[key] = { content: JSON.stringify({ version: 1, size: bytes.length, chunks }) }
  }
  return index
}

export async function unpackSessions(workspace: EncryptedWorkspace, index: SyncSnapshot): Promise<SyncSnapshot> {
  const snapshot: SyncSnapshot = {}
  let total = 0
  for (const [key, record] of Object.entries(index)) {
    const { version, size, chunks } = JSON.parse(record.content)
    if (version !== 1 || !Number.isInteger(size) || size <= 0 || size > maxSessionBytes || !Array.isArray(chunks) || chunks.length !== Math.ceil(size / chunkSize)) throw new Error("会话分块索引无效")
    total += size
    if (total > 128 * 1024 * 1024) throw new Error("本次会话同步超过 128 MiB")
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const hash of chunks) {
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("会话分块指纹无效")
      const piece = (await workspace.snapshot("sessions", `session-chunk/${hash}`))[valueKey]
      if (!piece) throw new Error("会话附件尚未同步完整，请稍后重试")
      const content = decodeBytes(piece.content)
      if (content.length !== Math.min(chunkSize, size - offset) || await digest(content) !== hash) throw new Error("会话分块校验失败")
      bytes.set(content, offset); offset += content.length
    }
    snapshot[key] = { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  }
  return snapshot
}
