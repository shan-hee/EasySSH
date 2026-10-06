const eventName = "easyssh:resource-error"
let resourceError: Error | null = null

export function reportResourceError(error: Error) {
  resourceError = error
  if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName))
}

export function getResourceError() {
  return resourceError
}

export function subscribeResourceErrors(listener: () => void) {
  window.addEventListener(eventName, listener)
  return () => window.removeEventListener(eventName, listener)
}
