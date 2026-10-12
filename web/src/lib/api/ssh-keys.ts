import { currentWorkspace } from "@/lib/secure-runtime/session"
import { scheduleSync } from "@/lib/secure-runtime/records"

export interface SSHKey {
  id: number
  created_at: string
  user_id: string
  name: string
  public_key: string
  fingerprint: string
  algorithm: string
  key_size?: number
  passphrase_required: boolean
}

export interface SSHKeyWithPrivateKey extends SSHKey {
  private_key: string // 仅在生成时返回
}

export interface GenerateSSHKeyRequest {
  name: string
  algorithm: "rsa" | "ed25519"
  key_size?: number // 仅RSA需要，默认2048
}

export interface ImportSSHKeyRequest {
  name: string
  private_key: string
  passphrase?: string
}


type StoredKey = SSHKey & { private_key: string; passphrase: string }
async function storedKeys() {
  const snapshot = await currentWorkspace().snapshot("credentials", "ssh-keys")
  return Object.entries(snapshot).map(([key, value]) => ({ key, value: JSON.parse(value.content) as StoredKey }))
}
export async function getSSHKeys(): Promise<SSHKey[]> {
  return (await storedKeys()).map(({ value: { private_key: _key, passphrase: _pass, ...metadata } }) => metadata)
}
export async function getLocalSSHKey(id: number) {
  if ((await currentWorkspace().conflicts("credentials", "ssh-keys")).length) throw new Error("SSH 密钥库有并发冲突，请先选择版本")
  const key = (await storedKeys()).find(({ value }) => value.id === id)?.value
  if (!key) throw new Error("本机 SSH 密钥不存在")
  return key
}
export async function generateSSHKey(data: GenerateSSHKeyRequest): Promise<SSHKeyWithPrivateKey> {
  const private_key = await currentWorkspace().crypto.call<string>("generate_ssh_key", { algorithm: data.algorithm, key_size: data.key_size })
  const metadata = await importSSHKey({ name: data.name, private_key })
  return { ...metadata, private_key }
}
export async function importSSHKey(data: ImportSSHKeyRequest): Promise<SSHKey> {
  const workspace = currentWorkspace()
  if (!data.name.trim()) throw new Error("请输入密钥名称")
  const inspected = await workspace.crypto.call<Pick<SSHKey, "public_key" | "fingerprint" | "algorithm" | "key_size" | "passphrase_required">>("inspect_ssh_key", { private_key: data.private_key, passphrase: data.passphrase || "" })
  const existing = (await getSSHKeys()).find((key) => key.fingerprint === inspected.fingerprint)
  if (existing) return existing
  const random = crypto.getRandomValues(new Uint32Array(2))
  const id = ((random[0] & 0x1fffff) * 0x100000000 + random[1]) || 1
  const metadata: SSHKey = { id, name: data.name, user_id: workspace.owner, created_at: new Date().toISOString(), ...inspected }
  await workspace.edit("credentials", "ssh-keys", (snapshot) => ({ ...snapshot, ['value/' + crypto.randomUUID()]: { content: JSON.stringify({ ...metadata, private_key: data.private_key, passphrase: data.passphrase || "" }) } }))
  scheduleSync(); return metadata
}
export async function deleteSSHKey(id: number): Promise<void> {
  const workspace = currentWorkspace()
  await workspace.edit("credentials", "ssh-keys", (snapshot) => {
    for (const [key, record] of Object.entries(snapshot)) if (JSON.parse(record.content).id === id) delete snapshot[key]
    return snapshot
  })
  scheduleSync()
}
export interface SSHKeyApi { list: () => Promise<SSHKey[]>; import: (input: ImportSSHKeyRequest) => Promise<SSHKey>; delete: (id: number) => Promise<void> }
export const sshKeyApi: SSHKeyApi = { list: getSSHKeys, import: importSSHKey, delete: deleteSSHKey }
