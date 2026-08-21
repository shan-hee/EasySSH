export const MAX_COMPOSER_ATTACHMENTS = 5
export const ATTACHMENT_TEXT_READ_LIMIT = 64 * 1024
export const ATTACHMENT_TEXT_PREVIEW_LIMIT = 12_000
export const ATTACHMENT_IMAGE_SIZE_LIMIT = 8 * 1024 * 1024
export const ATTACHMENT_TOTAL_SIZE_LIMIT = 16 * 1024 * 1024

export type AgentImageAttachment = {
  id: string
  name: string
  media_type: string
  data: string
  size: number
}

export type ComposerAttachment = {
  id: string
  name: string
  size: number
  type: string
  source: "text" | "metadata" | "image"
  content?: string
  file?: File
  previewUrl?: string
  truncated: boolean
}

const textExtensions = [
  ".txt",
  ".log",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".xml",
  ".csv",
  ".conf",
  ".ini",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".go",
  ".rs",
  ".java",
  ".sql",
  ".env",
]

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isTextLikeFile(file: File) {
  const lowerName = file.name.toLowerCase()

  return (
    file.type.startsWith("text/") ||
    file.type.includes("json") ||
    file.type.includes("xml") ||
    file.type.includes("yaml") ||
    file.type.includes("javascript") ||
    file.type.includes("typescript") ||
    textExtensions.some((extension) => lowerName.endsWith(extension))
  )
}

export async function createComposerAttachment(file: File): Promise<ComposerAttachment> {
  const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`

  if (file.type.startsWith("image/")) {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      throw new Error(`Unsupported image type: ${file.type}`)
    }
    if (file.size <= 0 || file.size > ATTACHMENT_IMAGE_SIZE_LIMIT) {
      throw new Error(`Image exceeds ${ATTACHMENT_IMAGE_SIZE_LIMIT} byte limit`)
    }
    return {
      id,
      name: file.name || `pasted-image-${Date.now()}.png`,
      size: file.size,
      type: file.type,
      source: "image",
      file,
      previewUrl: URL.createObjectURL(file),
      truncated: false,
    }
  }

  if (!isTextLikeFile(file)) {
    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      source: "metadata",
      truncated: false,
    }
  }

  const rawText = await file.slice(0, ATTACHMENT_TEXT_READ_LIMIT).text()
  const sanitizedText = rawText.split(String.fromCharCode(0)).join("")
  const content = sanitizedText.slice(0, ATTACHMENT_TEXT_PREVIEW_LIMIT)
  const truncated =
    file.size > ATTACHMENT_TEXT_READ_LIMIT ||
    sanitizedText.length > ATTACHMENT_TEXT_PREVIEW_LIMIT

  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type || "text/plain",
    source: "text",
    content,
    truncated,
  }
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function toAgentImageAttachments(attachments: ComposerAttachment[]): Promise<AgentImageAttachment[]> {
  const result: AgentImageAttachment[] = []
  for (const attachment of attachments) {
    if (attachment.source !== "image" || !attachment.file) {
      continue
    }
    result.push({
      id: attachment.id,
      name: attachment.name,
      media_type: attachment.type,
      data: await fileToBase64(attachment.file),
      size: attachment.size,
    })
  }
  return result
}

export function releaseComposerAttachment(attachment: ComposerAttachment) {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}
