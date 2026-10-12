export interface SftpConnectionHistory { serverId: string; path: string; usedAt: number }
let history: SftpConnectionHistory[] = []
export function readSftpConnectionHistory(): SftpConnectionHistory[] { return history.map((entry) => ({...entry})) }
export function rememberSftpDirectory(serverId: string, path: string) { history = [{serverId,path,usedAt:Date.now()},...history.filter((entry)=>entry.serverId!==serverId)].slice(0,20) }
window.addEventListener("easyssh:workspace-locked", () => { history=[] })
// Remove the former plaintext path cache once; directory history now lives in memory.
try { localStorage.removeItem("easyssh:sftp:connection-history") } catch { /* Storage can be unavailable. */ }
