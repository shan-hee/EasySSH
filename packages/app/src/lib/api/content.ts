import { apiFetch } from "@/lib/api-client"
import type { ContentChunk, ContentChunkReader } from "@/lib/content"

/** 实例内容接口的分块读取；摘要用于确认读取的仍是引用时的版本。 */
export const readInstanceContentChunk: ContentChunkReader = (reference, offset) => {
  const params = new URLSearchParams({ sha256: reference.sha256, offset: String(offset) })
  return apiFetch<ContentChunk>(`/content/${encodeURIComponent(reference.id)}/bytes?${params.toString()}`, { retry: false })
}
