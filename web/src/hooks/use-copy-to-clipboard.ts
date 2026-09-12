// Based on assistant-ui's use-copy-to-clipboard registry entry. The writer also
// supports desktop WebViews; the reset timer is released when unmounted.
import { useEffect, useRef, useState } from "react"
import { writeClipboardText } from "@/lib/clipboard"

export function useCopyToClipboard({ copiedDuration = 3000 }: { copiedDuration?: number } = {}) {
  const [isCopied, setIsCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copyToClipboard = async (value: string) => {
    if (!value) return
    await writeClipboardText(value)
    setIsCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setIsCopied(false), copiedDuration)
  }
  return { isCopied, copyToClipboard }
}
