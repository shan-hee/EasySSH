// Desktop WebViews can reject Clipboard API writes. Keep the platform-specific
// writer separate from assistant-ui's copy state and controls.
export async function writeAgentClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement("textarea")
    const focused = document.activeElement
    textarea.value = text
    textarea.style.cssText = "position:fixed;left:-9999px"
    document.body.append(textarea)
    textarea.select()
    try {
      if (!document.execCommand("copy")) throw new Error("Clipboard write failed")
    } finally {
      textarea.remove()
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    }
  }
}
