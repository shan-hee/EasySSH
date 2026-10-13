const KEY = "easyssh:sftp:connection-history"
export interface SftpConnectionHistory { serverId: string; path: string; usedAt: number }

export function readSftpConnectionHistory(): SftpConnectionHistory[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]")
    return Array.isArray(value) ? value.filter(item => typeof item.serverId === "string" && typeof item.path === "string" && typeof item.usedAt === "number").slice(0, 20) : []
  } catch { return [] }
}

export function rememberSftpDirectory(serverId: string, path: string) {
  const entries = readSftpConnectionHistory()
  if (entries[0]?.serverId === serverId && entries[0]?.path === path) return
  try {
    localStorage.setItem(KEY, JSON.stringify([{ serverId, path, usedAt: Date.now() }, ...entries.filter(item => item.serverId !== serverId)].slice(0, 20)))
  } catch { /* Browsing still works when preferences cannot be stored. */ }
}
