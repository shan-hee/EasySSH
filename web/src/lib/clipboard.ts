// Shared by terminal selection, copy actions and assistant messages.
// Desktop WebViews can reject Clipboard API writes.
export async function writeClipboardText(text: string) {
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
