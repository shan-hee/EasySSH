import type { components } from "@/generated/openapi"

export type ContentReference = components["schemas"]["ContentReference"]
export type ContentChunk = components["schemas"]["ContentChunk"]

/** 宿主提供的分块读取：按偏移返回一段 base64 正文。 */
export type ContentChunkReader = (reference: ContentReference, offset: number) => Promise<ContentChunk>

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 按分块读取整份正文。 */
export async function readContentBytes(reference: ContentReference, readChunk: ContentChunkReader): Promise<Uint8Array> {
  const result = new Uint8Array(reference.size)
  let offset = 0
  while (offset < reference.size) {
    const chunk = await readChunk(reference, offset)
    const bytes = decodeBase64(chunk.data)
    if (chunk.offset !== offset || chunk.next_offset !== offset + bytes.length || bytes.length === 0) {
      throw new Error("Content chunk does not match the requested range")
    }
    result.set(bytes, offset)
    offset = chunk.next_offset
  }
  return result
}

export async function readContentJSON<T>(reference: ContentReference, readChunk: ContentChunkReader): Promise<T> {
  const bytes = await readContentBytes(reference, readChunk)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
