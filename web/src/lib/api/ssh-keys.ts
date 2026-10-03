import { apiFetch } from "@/lib/api-client"

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

/**
 * 获取当前用户的SSH密钥列表
 */
export async function getSSHKeys(): Promise<SSHKey[]> {
  return apiFetch<SSHKey[]>("/ssh-keys")
}

/**
 * 生成新的SSH密钥对
 */
export async function generateSSHKey(
  data: GenerateSSHKeyRequest
): Promise<SSHKeyWithPrivateKey> {
  return apiFetch<SSHKeyWithPrivateKey>("/ssh-keys/generate", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

/**
 * 导入已有的SSH密钥
 */
export async function importSSHKey(
  data: ImportSSHKeyRequest
): Promise<SSHKey> {
  return apiFetch<SSHKey>("/ssh-keys/import", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export interface SSHKeyApi {
  list: () => Promise<SSHKey[]>
  import: (input: ImportSSHKeyRequest) => Promise<SSHKey>
  delete: (id: number) => Promise<void>
}

export const sshKeyApi: SSHKeyApi = {
  list: getSSHKeys,
  import: importSSHKey,
  delete: deleteSSHKey,
}

/**
 * 删除SSH密钥
 */
export async function deleteSSHKey(id: number): Promise<void> {
  await apiFetch(`/ssh-keys/${id}`, {
    method: "DELETE",
  })
}
