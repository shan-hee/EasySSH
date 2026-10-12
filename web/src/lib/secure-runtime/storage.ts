export interface SecureStorage {
  read<T>(key: string): Promise<T | undefined>
  write(values: Record<string, unknown>): Promise<void>
  keys(prefix: string): Promise<string[]>
}

// Only ciphertext, wrapped keys and public protocol metadata go into this DB.
// A write resolves after the transaction commits, not after the last put request.
export class BrowserSecureStorage implements SecureStorage {
  private db: Promise<IDBDatabase>
  constructor(private owner: string) {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open("easyssh-client-encrypted-v5", 1)
      request.onupgradeneeded = () => request.result.createObjectStore("encrypted")
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error("Close the other EasySSH tabs before upgrading encrypted storage"))
    })
  }
  private id(key: string) { return `${this.owner}\u0000${key}` }
  async read<T>(key: string): Promise<T | undefined> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted", "readonly")
      const request = tx.objectStore("encrypted").get(this.id(key))
      tx.oncomplete = () => resolve(request.result as T | undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error("Encrypted storage read aborted"))
    })
  }
  async write(values: Record<string, unknown>): Promise<void> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted", "readwrite", { durability: "strict" })
      const store = tx.objectStore("encrypted")
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) store.delete(this.id(key))
        else store.put(value, this.id(key))
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error("Encrypted storage write aborted"))
    })
  }
  async keys(prefix: string): Promise<string[]> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted", "readonly")
      const request = tx.objectStore("encrypted").getAllKeys(IDBKeyRange.bound(this.id(prefix), `${this.id(prefix)}\uffff`))
      tx.oncomplete = () => resolve(request.result.map((key) => String(key).slice(this.owner.length + 1)))
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error("Encrypted storage read aborted"))
    })
  }
}
