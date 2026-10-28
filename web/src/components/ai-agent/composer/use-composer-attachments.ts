import { useCallback, useEffect, useRef, useState } from "react"

import {
  ATTACHMENT_TOTAL_SIZE_LIMIT,
  MAX_COMPOSER_ATTACHMENTS,
  createComposerAttachment,
  releaseComposerAttachment,
  type ComposerAttachment,
} from "./attachments"

export function useComposerAttachments({
  sessionId,
  onLimit,
  onRejected,
}: {
  sessionId: string | null
  onLimit?: (limit: number) => void
  onRejected?: (file: File, reason: "total-size" | "read") => void
}) {
  const drafts = useRef(new Map<string | null, ComposerAttachment[]>())
  const [, render] = useState(0)
  const [loading, setLoading] = useState(false)
  const addQueueRef = useRef<Promise<void>>(Promise.resolve())
  const update = useCallback((id: string | null, items: ComposerAttachment[]) => {
    if (items.length) drafts.current.set(id, items)
    else drafts.current.delete(id)
    render((revision) => revision + 1)
  }, [])

  useEffect(() => () => {
    drafts.current.forEach((items) => items.forEach(releaseComposerAttachment))
    drafts.current.clear()
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    const current = drafts.current.get(sessionId) ?? []
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
      update(sessionId, [
        ...(drafts.current.get(sessionId) ?? []),
        ...created.filter((attachment): attachment is ComposerAttachment => attachment !== null),
      ])
    } finally {
      setLoading(false)
    }
  }, [onLimit, onRejected, sessionId, update])

  const addFiles = useCallback((files: File[]) => {
    const operation = addQueueRef.current.then(() => processFiles(files))
    addQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [processFiles])

  const remove = useCallback((attachmentId: string) => {
    const current = drafts.current.get(sessionId) ?? []
    const target = current.find((attachment) => attachment.id === attachmentId)
    if (target) releaseComposerAttachment(target)
    update(sessionId, current.filter((attachment) => attachment.id !== attachmentId))
  }, [sessionId, update])

  const forget = useCallback((id: string) => {
    drafts.current.get(id)?.forEach(releaseComposerAttachment)
    update(id, [])
  }, [update])

  const detach = useCallback(() => {
    const current = drafts.current.get(sessionId) ?? []
    update(sessionId, [])
    return current
  }, [sessionId, update])

  const restore = useCallback((items: ComposerAttachment[], targetId = sessionId) => {
    // A failed send must not discard files added while the request was running.
    update(targetId, [...items, ...(drafts.current.get(targetId) ?? [])])
  }, [sessionId, update])

  const release = useCallback((items: ComposerAttachment[]) => {
    items.forEach(releaseComposerAttachment)
  }, [])

  return {
    attachments: drafts.current.get(sessionId) ?? [],
    loading,
    addFiles,
    remove,
    forget,
    detach,
    restore,
    release,
  }
}
