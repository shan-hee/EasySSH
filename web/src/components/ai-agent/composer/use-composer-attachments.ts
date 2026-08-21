import { useCallback, useEffect, useRef, useState } from "react"

import {
  ATTACHMENT_TOTAL_SIZE_LIMIT,
  MAX_COMPOSER_ATTACHMENTS,
  createComposerAttachment,
  releaseComposerAttachment,
  type ComposerAttachment,
} from "./attachments"

export function useComposerAttachments({
  onLimit,
  onRejected,
}: {
  onLimit?: (limit: number) => void
  onRejected?: (file: File, reason: "total-size" | "read") => void
} = {}) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const attachmentsRef = useRef(attachments)
  const addQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => () => {
    attachmentsRef.current.forEach(releaseComposerAttachment)
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    const current = attachmentsRef.current
    const remainingSlots = MAX_COMPOSER_ATTACHMENTS - current.length
    if (files.length === 0 || remainingSlots <= 0) {
      if (files.length > 0) onLimit?.(MAX_COMPOSER_ATTACHMENTS)
      return
    }

    const currentSize = current.reduce((total, attachment) => total + attachment.size, 0)
    let pendingSize = currentSize
    const accepted: File[] = []
    for (const file of files.slice(0, remainingSlots)) {
      if (pendingSize + file.size > ATTACHMENT_TOTAL_SIZE_LIMIT) {
        onRejected?.(file, "total-size")
        continue
      }
      pendingSize += file.size
      accepted.push(file)
    }
    if (files.length > remainingSlots) {
      onLimit?.(MAX_COMPOSER_ATTACHMENTS)
    }
    if (accepted.length === 0) {
      return
    }

    setLoading(true)
    try {
      const created = await Promise.all(accepted.map(async (file) => {
        try {
          return await createComposerAttachment(file)
        } catch {
          onRejected?.(file, "read")
          return null
        }
      }))
      setAttachments((existing) => {
        const next = [
          ...existing,
          ...created.filter((attachment): attachment is ComposerAttachment => attachment !== null),
        ]
        attachmentsRef.current = next
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [onLimit, onRejected])

  const addFiles = useCallback((files: File[]) => {
    const operation = addQueueRef.current.then(() => processFiles(files))
    addQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [processFiles])

  const remove = useCallback((attachmentId: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId)
      if (target) releaseComposerAttachment(target)
      const next = current.filter((attachment) => attachment.id !== attachmentId)
      attachmentsRef.current = next
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setAttachments((current) => {
      current.forEach(releaseComposerAttachment)
      attachmentsRef.current = []
      return []
    })
  }, [])

  const detach = useCallback(() => {
    const current = attachmentsRef.current
    attachmentsRef.current = []
    setAttachments([])
    return current
  }, [])

  const restore = useCallback((items: ComposerAttachment[]) => {
    setAttachments((current) => {
      current.forEach(releaseComposerAttachment)
      attachmentsRef.current = items
      return items
    })
  }, [])

  const release = useCallback((items: ComposerAttachment[]) => {
    items.forEach(releaseComposerAttachment)
  }, [])

  return {
    attachments,
    loading,
    addFiles,
    remove,
    clear,
    detach,
    restore,
    release,
  }
}
