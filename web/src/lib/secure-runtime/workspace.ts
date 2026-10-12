import { decodeBytes, encodeBytes } from "./browser-ssh"
import { allScopes, type CryptoRPC, type CryptoView, type EncryptedObject, type LocalEnvelope, type Manifest, type PublicDevice, type Scope } from "./crypto"
import type { SecureStorage } from "./storage"
import type { SyncSnapshot } from "@/lib/sync/automerge"

export type EncryptedTransport = <T>(path: string, body?: unknown) => Promise<T>
type LocalDocument = { scope: Scope; object: EncryptedObject; remoteHeads: string[]; dirty: boolean }
type Head = { scope: Scope; document: string; object: string }
type Engine = typeof import("@/lib/sync/automerge")

export class EncryptedWorkspace {
  view: CryptoView | null = null
  ready = false
  error = ""
  lastSync = ""
  private engine?: Engine
  private stopped = false
  get closed() { return this.stopped }
  private serial: Promise<unknown> = Promise.resolve()
  private manifests: Record<string, Manifest> = {}
  private listeners = new Set<() => void>()
  private lockChannel: BroadcastChannel
  constructor(readonly owner: string, readonly crypto: CryptoRPC, readonly storage: SecureStorage, readonly transport: EncryptedTransport) {
    this.lockChannel = new BroadcastChannel(`easyssh-lock:${owner}`)
    this.lockChannel.onmessage = () => this.close()
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) listener(); window.dispatchEvent(new Event("easyssh:sync-status-changed")) }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.stopped) throw new Error("Encrypted workspace is closed")
      // Browsers supported by the SSH runtime also support Web Locks. Without
      // cross-tab serialization, silently continuing could lose offline writes.
      if (!navigator.locks) throw new Error("This browser does not support safe multi-tab encrypted storage")
      return navigator.locks.request(`easyssh-encrypted:${this.owner}`, async () => {
        if (this.stopped) throw new Error("Encrypted workspace is closed")
        if (this.view?.manifest.revision) {
          const saved = await this.storage.read<Record<string, Manifest>>("manifests") ?? {}
          const newer = Object.values(saved).filter((m) => m.revision > this.view!.manifest.revision).sort((a, b) => a.revision - b.revision)
          if (newer.length) {
            this.view = await this.acceptView(this.view.manifest.space, newer)
            this.manifests = saved
          }
        }
        return action()
      })
    }
    const result = this.serial.then(run, run)
    this.serial = result.catch(() => {})
    return result
  }
  async hasLocalKeys() { return !!await this.storage.read("keys") }
  private validatePassword(password: string) {
    const length = new TextEncoder().encode(password).length
    if (length < 12 || length > 1024) throw new Error("解锁密码须为 12–1024 字节")
  }
  private async acceptView(space: string, chain: Manifest[]): Promise<CryptoView> {
    try { return await this.crypto.call("accept", { space, chain }) }
    catch (error) { this.close(); throw error }
  }
  async pendingRecovery() { return this.crypto.call<string>("pending_recovery") }
  async pairingCode() {
    const space = await this.storage.read<string>("pair_space")
    if (!space || !this.view) return ""
    return encodeBytes(new TextEncoder().encode(JSON.stringify({ version: 5, space, device: this.view.device })))
  }
  private async loadEngine() { return this.engine ??= await import("@/lib/sync/automerge") }
  private requireUnlocked(scope?: Scope) {
    if (!this.view || this.stopped) throw new Error("请先解锁加密工作区")
    if (scope && !this.view.scopes.includes(scope)) throw new Error(`此设备未获授权：${scope}`)
    return this.view
  }
  private async persist(extra: Record<string, unknown> = {}) {
    const keys = await this.crypto.call<LocalEnvelope>("persist", { owner: this.owner })
    if (this.stopped) throw new Error("Encrypted workspace is closed")
    await this.storage.write({ keys, manifests: this.manifests, ...extra })
  }
  async initialize(password: string, name: string): Promise<string> {
    this.validatePassword(password)
    return this.exclusive(async () => {
      if (await this.hasLocalKeys()) throw new Error("本机已有密钥，请解锁或恢复，不能覆盖现有密钥")
      const remote = await this.transport<Manifest[]>("/manifests")
      if (remote.length) throw new Error("此账号已有加密空间，请配对或使用恢复密钥")
      const initialized = await this.crypto.call<{ recovery: string; view: CryptoView }>("initialize", { name })
      // Publication waits for the recovery-code confirmation in the UI.
      const keys = await this.crypto.call<LocalEnvelope>("save", { password, owner: this.owner })
      const manifests = await this.crypto.call<Record<string, Manifest>>("manifest_index", { chain: [initialized.view.manifest] })
      await this.storage.write({ keys, manifests, unpublished: initialized.view.manifest })
      if (this.stopped) throw new Error("Encrypted workspace is closed")
      this.manifests = manifests; this.view = initialized.view
      this.notify()
      return initialized.recovery
    })
  }
  async publishInitialization(recoverySaved = false) {
    await this.exclusive(async () => {
      this.requireUnlocked()
      if (await this.pendingRecovery() && !recoverySaved) throw new Error("请先确认已离线保存恢复密钥")
      const manifest = await this.storage.read<Manifest>("unpublished")
      if (!manifest) return
      await this.transport("/manifests", manifest)
      await this.crypto.call("confirm_recovery")
      await this.persist({ unpublished: undefined })
      this.notify()
    })
    await this.sync()
  }
  async unlock(password: string) {
    await this.exclusive(async () => {
      const local = await this.storage.read<LocalEnvelope>("keys")
      if (!local) throw new Error("本机尚未配对，请创建空间、配对或恢复")
      this.view = await this.crypto.call("unlock", { password, owner: this.owner, local })
      this.manifests = await this.storage.read<Record<string, Manifest>>("manifests") ?? {}
      this.ready = !!this.view?.manifest.revision && !await this.storage.read("unpublished") && !!await this.storage.read("initialized_cache")
      this.notify()
    })
    if (this.view?.manifest.revision && !await this.storage.read("unpublished")) await this.sync()
  }
  async pairingRequest(password: string, name: string): Promise<string> {
    this.validatePassword(password)
    return this.exclusive(async () => {
      if (await this.hasLocalKeys()) throw new Error("本机已有密钥，请先解锁")
      const chain = await this.transport<Manifest[]>("/manifests")
      if (!chain.length) throw new Error("账号尚无加密空间")
      const space = chain[0].space
      const device = await this.crypto.call<PublicDevice>("new_device", { name })
      const keys = await this.crypto.call<LocalEnvelope>("save", { password, owner: this.owner })
      await this.storage.write({ keys, pair_space: space })
      this.view = await this.crypto.call("view")
      this.notify()
      return encodeBytes(new TextEncoder().encode(JSON.stringify({ version: 5, space, device })))
    })
  }
  async completePairing() {
    await this.exclusive(async () => {
      const space = await this.storage.read<string>("pair_space")
      if (!space) throw new Error("没有待完成的配对请求")
      const chain = await this.transport<Manifest[]>("/manifests")
      this.view = await this.acceptView(space, chain)
      this.manifests = await this.crypto.call("manifest_index", { chain })
      await this.persist({ pair_space: undefined })
      this.notify()
    })
    await this.sync()
  }
  async authorize(code: string, scopes: Scope[], admin: boolean) {
    await this.exclusive(async () => {
      await this.refreshManifest()
      const view = this.requireUnlocked()
      if (code.length > 4096) throw new Error("配对请求过大")
      const request = JSON.parse(new TextDecoder().decode(decodeBytes(code))) as { version: number; space: string; device: PublicDevice }
      if (request.version !== 5 || request.space !== view.manifest.space) throw new Error("配对空间指纹不一致")
      const manifest = await this.crypto.call<Manifest>("authorize", { device: request.device, scopes: admin ? allScopes : scopes, admin })
      await this.transport("/manifests", manifest)
      await this.accept([manifest])
    })
  }
  async recover(code: string, password: string, name: string) {
    this.validatePassword(password)
    await this.exclusive(async () => {
      if (await this.hasLocalKeys()) throw new Error("本机已有密钥；请在新的浏览器配置或设备恢复，以保留未同步的数据")
      const chain = await this.transport<Manifest[]>("/manifests")
      const manifest = await this.crypto.call<Manifest>("recover", { code, name, chain })
      const view = await this.acceptView(manifest.space, [manifest])
      const manifests = await this.crypto.call<Record<string, Manifest>>("manifest_index", { chain: [...chain, manifest] })
      const keys = await this.crypto.call<LocalEnvelope>("save", { password, owner: this.owner })
      await this.storage.write({ keys, manifests, unpublished: manifest })
      if (this.stopped) throw new Error("Encrypted workspace is closed")
      this.view = view; this.manifests = manifests
      this.notify()
    })
    await this.publishInitialization()
  }
  async revoke(deviceID: string) {
    await this.exclusive(async () => {
      await this.refreshManifest()
      const manifest = await this.crypto.call<Manifest>("revoke", { device_id: deviceID })
      await this.transport("/manifests", manifest)
      await this.accept([manifest])
    })
    // The user explicitly requested this rotation. Republish current snapshots
    // under the new epochs, leaving old backup copies outside revocation's scope.
    await this.sync(true)
  }
  private async accept(chain: Manifest[]) {
    if (!chain.length) return
    const space = this.requireUnlocked().manifest.space
    this.view = await this.acceptView(space, chain)
    Object.assign(this.manifests, await this.crypto.call("manifest_index", { chain }))
    await this.persist()
    this.notify()
  }
  private async refreshManifest() {
    const view = this.requireUnlocked()
    if (!view.manifest.revision) throw new Error("请完成设备配对")
    if (await this.storage.read("unpublished")) throw new Error("请确认已保存恢复密钥，再发布加密空间")
    const chain = await this.transport<Manifest[]>(`/manifests?after=${view.manifest.revision}`)
    await this.accept(chain)
  }
  async documentID(scope: Scope, resource: string) { return this.crypto.call<string>("document_id", { scope, resource }) }
  async projectionBaseline(scope: Scope, resource: string): Promise<SyncSnapshot> {
    return this.exclusive(async () => {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      const object = await this.storage.read<EncryptedObject>(`projection:${id}`)
      return object ? JSON.parse(new TextDecoder().decode(decodeBytes(await this.decode(object)))) : {}
    })
  }
  async saveProjectionBaseline(scope: Scope, resource: string, snapshot: SyncSnapshot) {
    await this.exclusive(async () => {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      const object = await this.crypto.call<EncryptedObject>("seal", { scope, document: id, parents: [], data: encodeBytes(new TextEncoder().encode(JSON.stringify(snapshot))) })
      await this.persist({ [`projection:${id}`]: object })
    })
  }
  private async decode(object: EncryptedObject): Promise<string> {
    const manifest = this.manifests[object.manifest]
    if (!manifest) throw new Error("缺少已验证的设备授权历史")
    return this.crypto.call<string>("open", { object, manifest })
  }
  async snapshot(scope: Scope, resource: string): Promise<SyncSnapshot> {
    return this.exclusive(async () => {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      const local = await this.storage.read<LocalDocument>(`doc:${id}`)
      if (!local) return {}
      const engine = await this.loadEngine()
      const document = engine.loadDocument(await this.decode(local.object))
      try { return engine.projectDocument(document).snapshot } finally { engine.freeDocument(document) }
    })
  }
  async edit(scope: Scope, resource: string, edit: (current: SyncSnapshot) => SyncSnapshot) {
    return this.editMany([{ scope, resource, edit }])
  }
  async editMany(changes: { scope: Scope; resource: string; edit(current: SyncSnapshot): SyncSnapshot }[]) {
    await this.exclusive(async () => {
      if (await this.storage.read("unpublished")) throw new Error("请先保存并确认恢复密钥")
      const updates: Record<string, LocalDocument> = {}
      for (const { scope, resource, edit } of changes) {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      if (updates[`doc:${id}`]) throw new Error("同一事务不能重复修改文档")
      const local = await this.storage.read<LocalDocument>(`doc:${id}`)
      const engine = await this.loadEngine()
      let document = engine.loadDocument(local ? await this.decode(local.object) : "")
      try {
        document = engine.reconcileDocument(document, edit(engine.projectDocument(document).snapshot))
        const object = await this.crypto.call<EncryptedObject>("seal", { scope, document: id, parents: local?.remoteHeads ?? [], data: engine.saveDocument(document) })
        updates[`doc:${id}`] = { scope, object, remoteHeads: local?.remoteHeads ?? [], dirty: true }
      } finally { engine.freeDocument(document) }
      }
      await this.persist(updates)
      window.dispatchEvent(new Event("easyssh:sync-applied"))
    })
  }
  async conflicts(scope: Scope, resource: string) {
    return this.exclusive(async () => {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      const local = await this.storage.read<LocalDocument>(`doc:${id}`)
      if (!local) return []
      const engine = await this.loadEngine()
      const document = engine.loadDocument(await this.decode(local.object))
      try { return engine.projectDocument(document).conflicts } finally { engine.freeDocument(document) }
    })
  }
  async resolve(scope: Scope, resource: string, key: string, field: string, value: string) {
    await this.exclusive(async () => {
      this.requireUnlocked(scope)
      const id = await this.documentID(scope, resource)
      const local = await this.storage.read<LocalDocument>(`doc:${id}`)
      if (!local) throw new Error("同步文档不存在")
      const engine = await this.loadEngine()
      let document = engine.loadDocument(await this.decode(local.object))
      try {
        document = engine.resolveConflict(document, key, field, value)
        const object = await this.crypto.call<EncryptedObject>("seal", { scope, document: id, parents: local.remoteHeads, data: engine.saveDocument(document) })
        await this.persist({ [`doc:${id}`]: { ...local, object, dirty: true } })
      } finally { engine.freeDocument(document) }
    })
    await this.sync()
  }
  async sync(confirmEpochUpgrade = false) {
    try {
      await this.exclusive(async () => {
        await this.refreshManifest()
        const view = this.requireUnlocked()
        const heads = await this.transport<Head[]>("/heads")
        const grouped = new Map<string, Head[]>()
        for (const head of heads) {
          if (!view.scopes.includes(head.scope)) continue
          const entries = grouped.get(head.document) ?? []
          entries.push(head); grouped.set(head.document, entries)
        }
        const localIDs = (await this.storage.keys("doc:")).map((key) => key.slice(4))
        for (const id of new Set([...localIDs, ...grouped.keys()])) {
          const local = await this.storage.read<LocalDocument>(`doc:${id}`)
          const remote = grouped.get(id) ?? []
          const scope = local?.scope ?? remote[0]?.scope
          if (!scope || !view.scopes.includes(scope)) continue
          if (remote.some((head) => head.scope !== scope)) throw new Error("同步文档范围不一致")
          if (local?.dirty && local.object.epoch !== view.manifest.epochs[scope] && !confirmEpochUpgrade) throw new Error("密钥已轮换：本机有旧密钥代次的离线更改，请确认后重新加密同步")
          const cache = new Map<string, EncryptedObject>()
          const fetchObject = async (objectID: string) => {
            let object = cache.get(objectID)
            if (!object) {
              if (cache.size >= 10000) throw new Error("同步祖先链过大")
              object = await this.transport<EncryptedObject>(`/objects/${encodeURIComponent(objectID)}`)
              if (object.id !== objectID || object.document !== id || object.scope !== scope) throw new Error("同步对象上下文不一致")
              const manifest = this.manifests[object.manifest]
              if (!manifest) throw new Error("缺少同步签名历史")
              await this.crypto.call("verify_object", { object, manifest })
              cache.set(objectID, object)
            }
            return object
          }
          // A server must not silently hide previously observed heads. Verify
          // that each saved head is still reachable from the advertised DAG.
          const missing = new Set(local?.remoteHeads ?? [])
          const visited = new Set<string>()
          const queue = remote.map((head) => head.object)
          while (missing.size && queue.length) {
            const next = queue.pop()!
            if (visited.has(next)) continue
            visited.add(next); missing.delete(next)
            if (missing.size) queue.push(...(await fetchObject(next)).parents)
          }
          if (missing.size) throw new Error("服务端同步历史发生回退或缺失，已停止覆盖本地数据")
          const engine = await this.loadEngine()
          let document = engine.loadDocument(local ? await this.decode(local.object) : "")
          try {
            let rotationNeeded = false
            for (const head of remote) {
              const object = await fetchObject(head.object)
              rotationNeeded ||= object.epoch !== view.manifest.epochs[scope]
              if (object.id !== local?.object.id) document = engine.receive(document, { document: await this.decode(object), heads: [] })
            }
            const remoteHeads = remote.map((head) => head.object).sort()
            const needsUpload = !!local?.dirty || remote.length > 1 || rotationNeeded
            if (!needsUpload && local && JSON.stringify(local.remoteHeads) === JSON.stringify(remoteHeads)) continue
            if (!needsUpload && remote.length === 1) {
              await this.persist({ [`doc:${id}`]: { scope, object: await fetchObject(remote[0].object), remoteHeads, dirty: false } satisfies LocalDocument })
              continue
            }
            if (!needsUpload) continue
            const object = await this.crypto.call<EncryptedObject>("seal", { scope, document: id, parents: remoteHeads, data: engine.saveDocument(document) })
            // Durable outbox first. A failed upload can be retried without losing
            // a user's edit or exposing the document plaintext to the transport.
            await this.persist({ [`doc:${id}`]: { scope, object, remoteHeads, dirty: true } satisfies LocalDocument })
            await this.transport("/objects", object)
            await this.persist({ [`doc:${id}`]: { scope, object, remoteHeads: [object.id], dirty: false } satisfies LocalDocument })
          } finally { engine.freeDocument(document) }
        }
        this.error = ""; this.lastSync = new Date().toISOString()
        await this.storage.write({ initialized_cache: true })
        if (this.stopped) throw new Error("Encrypted workspace is closed")
        this.ready = true
        window.dispatchEvent(new Event("easyssh:sync-applied"))
      })
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally { this.notify() }
  }
  close() {
    if (this.stopped) return
    this.lockChannel.postMessage("lock"); this.lockChannel.close()
    this.stopped = true; this.ready = false; this.view = null; this.manifests = {}; this.crypto.close(); this.notify()
    window.dispatchEvent(new Event("easyssh:workspace-locked"))
  }
}
