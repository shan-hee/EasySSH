const active = new Map<string, number>()
export function isServerConnected(id: string) { return (active.get(id) ?? 0) > 0 }
export function setServerConnected(id: string, connected: boolean) {
  const count = (active.get(id) ?? 0) + (connected ? 1 : -1)
  if (count > 0) active.set(id, count)
  else active.delete(id)
  window.dispatchEvent(new Event("easyssh:sync-applied"))
}
