import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type SSHKey = components["schemas"]["SSHKey"]

/** 生成结果；私钥只在生成时返回一次。 */
export type SSHKeyWithPrivateKey = components["schemas"]["SSHKeyCreated"]

export type GenerateSSHKeyRequest = components["schemas"]["SSHKeyGenerateInput"]

export type ImportSSHKeyRequest = components["schemas"]["SSHKeyImportInput"]

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
    body: data,
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
    body: data,
  })
}

export interface SSHKeyApi {
  list: () => Promise<SSHKey[]>
  import: (input: ImportSSHKeyRequest) => Promise<SSHKey>
  delete: (id: string) => Promise<void>
}

export const sshKeyApi: SSHKeyApi = {
  list: getSSHKeys,
  import: importSSHKey,
  delete: deleteSSHKey,
}

/**
 * 删除SSH密钥
 */
export async function deleteSSHKey(id: string): Promise<void> {
  await apiFetch(`/ssh-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}
