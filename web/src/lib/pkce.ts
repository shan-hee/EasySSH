/**
 * PKCE 工具函数（仅在浏览器端使用）
 */

// Base64URL 编码
function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * 生成随机的 code_verifier（长度 43–128）
 */
export function generateCodeVerifier(length = 64): string {
  const maxLength = 128
  const minLength = 43
  const size = Math.min(Math.max(length, minLength), maxLength)

  const randomBytes = new Uint8Array(size)
  window.crypto.getRandomValues(randomBytes)

  return base64UrlEncode(randomBytes)
}

/**
 * 根据 code_verifier 计算 S256 的 code_challenge
 */
export async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const digest = await window.crypto.subtle.digest("SHA-256", data)
  const hashArray = new Uint8Array(digest)
  return base64UrlEncode(hashArray)
}
