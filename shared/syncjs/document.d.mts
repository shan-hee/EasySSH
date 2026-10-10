export type SyncSnapshot = Record<string, Record<string, string>>
export type SyncPeer = { document?: string; changes?: string[]; heads: string[] }
export type SyncConflict = { key: string; field: string; values: string[] }
export type SyncDoc = object
export function createEngine(automerge: unknown): {
  free(doc: SyncDoc): void
  load(value: string): SyncDoc
  save(doc: SyncDoc): string
  project(doc: SyncDoc): { snapshot: SyncSnapshot; conflicts: SyncConflict[] }
  reconcile(doc: SyncDoc, current: SyncSnapshot): SyncDoc
  outgoing(doc: SyncDoc, heads: string[]): SyncPeer
  receive(doc: SyncDoc, peer: SyncPeer): SyncDoc
  resolve(doc: SyncDoc, key: string, field: string, value: string): SyncDoc
}
