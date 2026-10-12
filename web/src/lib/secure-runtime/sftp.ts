import type { CompleteSftpSessionApi } from "@/lib/session/sftp-session-api"
import type { FileInfo, UploadTaskStatus } from "@/lib/sftp-types"
import { BrowserTerminal, connectedSSH } from "./terminal"
import { decodeBytes, encodeBytes, type BrowserSSHClient } from "./browser-ssh"
import { zipFiles } from "./zip"

const standalone = new Map<string, BrowserTerminal>()
const tasks = new Map<string, UploadTaskStatus>()
const cancelled = new Set<string>()
const join = (parent: string, name: string) => `${parent.replace(/\/$/, "")}/${name}`
const basename = (path: string) => path.replace(/\/$/, "").split("/").at(-1) || "download"
function task(id: string = crypto.randomUUID(), type = "upload") {
  const existing = tasks.get(id)
  if (existing) return existing
  for (const [key, value] of tasks) if (tasks.size >= 200 && ["completed", "failed", "cancelled"].includes(value.status)) { tasks.delete(key); cancelled.delete(key) }
  if (tasks.size >= 200) throw new Error("本机传输任务过多")
  const now = new Date().toISOString()
  const result: UploadTaskStatus = { id, type, file_name: "", file_size: 0, status: "pending", stage: "stream", progress: 0, loaded: 0, total: 0, speed_bps: 0, created_at: now, updated_at: now }
  tasks.set(id, result); return result
}
function check(id?: string) { if (id && cancelled.has(id)) throw new Error("传输已取消") }
function progress(t: UploadTaskStatus, loaded: number, total: number) {
  t.loaded = loaded; t.total = total; t.progress = total ? 100 * loaded / total : 100; t.updated_at = new Date().toISOString()
}
async function run<T>(t: UploadTaskStatus, fn: () => Promise<T>): Promise<T> {
  t.started_at = new Date().toISOString(); t.status = t.type === "download" ? "downloading" : t.type === "transfer" ? "transferring" : "uploading"
  try { check(t.id); const result = await fn(); check(t.id); t.status = "completed"; t.progress = 100; return result }
  catch (error) { t.status = cancelled.has(t.id) ? "cancelled" : "failed"; t.error = error instanceof Error ? error.message : String(error); throw error }
  finally { t.ended_at = t.updated_at = new Date().toISOString() }
}
async function read(client: BrowserSSHClient, path: string, limit: number, id?: string): Promise<Uint8Array> {
  check(id)
  const opened = await client.request<{ handle: string; size: number }>("download_open", { path })
  try {
    if (opened.size > limit) throw new Error("此文件超过浏览器内存下载限制，请使用桌面端")
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      check(id)
      const chunk = await client.request<{ data: string; eof: boolean }>("download_chunk", { handle: opened.handle, offset: size })
      const bytes = decodeBytes(chunk.data); size += bytes.length
      if (size > limit || (!bytes.length && !chunk.eof)) throw new Error("文件大小变化或下载内容无效")
      chunks.push(bytes)
      if (id) progress(task(id, "download"), size, opened.size)
      if (chunk.eof) break
    }
    const result = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return result
  } finally { await client.request("file_close", { handle: opened.handle }).catch(() => {}) }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a")
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000)
}
async function upload(client: BrowserSSHClient, path: string, blob: Blob, id?: string, onProgress?: (loaded: number, total: number) => void, overwrite = false) {
  const temporary = `${path}.easyssh-${crypto.randomUUID()}.part`
  const opened = await client.request<{ handle: string }>("upload_open", { path: temporary })
  let committed = false
  try {
    for (let offset = 0; offset < blob.size; offset += 65536) {
      check(id)
      const data = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer())
      await client.request("upload_chunk", { handle: opened.handle, offset, data: encodeBytes(data) })
      onProgress?.(offset + data.length, blob.size)
      if (id) progress(task(id), offset + data.length, blob.size)
    }
    await client.request("file_close", { handle: opened.handle }); check(id)
    const result = await client.request<FileInfo>("rename", { path: temporary, destination: path, overwrite })
    committed = true; return result
  } finally {
    await client.request("file_close", { handle: opened.handle }).catch(() => {})
    if (!committed) await client.request("remove", { path: temporary }).catch(() => {})
  }
}
async function walk(client: BrowserSSHClient, path: string, visit: (file: FileInfo) => Promise<void>, depth = 0, budget = { count: 0 }) {
  if (depth > 64 || ++budget.count > 10000) throw new Error("目录层级或文件数量超出限制")
  const info = await client.request<FileInfo>("stat", { path })
  if (info.is_dir && !info.is_link) {
    const listing = await client.request<{ files: FileInfo[] }>("list_directory", { path })
    for (const child of listing.files) await walk(client, child.path, visit, depth + 1, budget)
  }
  await visit(info)
}

export const browserSftpApi: CompleteSftpSessionApi = {
  uploadUsesProgressSocket: false, serverTransferUsesProgressSocket: false,
  async createUploadTask() { return { task_id: task().id } },
  async listUploadTasks() { return { tasks: [...tasks.values()].map((t) => ({ ...t })) } },
  async getUploadTask(id) { const t = tasks.get(id); if (!t) throw new Error("本机任务不存在"); return { ...t } },
  async getTransferTask(id) { return browserSftpApi.getUploadTask(id) },
  async cancelUploadTask(id) { cancelled.add(id) },
  async cancelTransfer(id) { cancelled.add(id) },
  async authenticate(serverID, authMethod, secret, privateKeyPassphrase, options) {
    await browserSftpApi.preAuthenticate(serverID, { authMethod, privateKeyPassphrase,
      password: options?.password ?? (authMethod.includes("password") ? secret : undefined), privateKey: options?.privateKey ?? (authMethod === "key" ? secret : undefined) },
      (_prompt, respond) => respond([], true))
  },
  async preAuthenticate(serverID, credential, onAuthPrompt, onHostKeyPrompt) {
    try { connectedSSH(serverID); return } catch { /* Establish a local SSH transport. */ }
    standalone.get(serverID)?.disconnect()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const terminal = new BrowserTerminal({ serverId: serverID, cols: 80, rows: 24, onData: (_data, consumed) => consumed?.(), enableCompletionFetch: false,
        onAuthPrompt, onHostKeyPrompt, onConnected: () => { settled = true; resolve() },
        onError: (e) => { if (!settled) { settled = true; reject(e) }; terminal.disconnect() },
        onDisconnected: () => { if (!settled) { settled = true; reject(new Error("SFTP 连接已关闭")) } },
      }, { ...credential, password: credential.password ?? (credential.authMethod?.includes("password") ? credential.secret : undefined), privateKey: credential.privateKey ?? (credential.authMethod === "key" ? credential.secret : undefined) }, true)
      standalone.set(serverID, terminal); terminal.connect()
    })
  },
  async listDirectory(serverID, path = ".") { return connectedSSH(serverID).request("list_directory", { path: path === "~" ? "." : path }) },
  async getFileInfo(serverID, path) { return connectedSSH(serverID).request("stat", { path }) },
  async getDiskUsage(serverID, path = "/") { return connectedSSH(serverID).request("disk_usage", { path }) },
  async createDirectory(serverID, path) { return connectedSSH(serverID).request("mkdir", { path }) },
  async delete(serverID, path) { return connectedSSH(serverID).request("remove", { path }) },
  async deletePaths(serverID, paths) {
    const client = connectedSSH(serverID)
    for (const path of paths) { if (!path || path === "~" || path.split("/").includes("..")) throw new Error("不能删除根目录或包含父目录跳转的路径"); const canonical = await client.request<string>("realpath", { path }); if (canonical === "/" || canonical === ".") throw new Error("不能删除根目录"); await walk(client, path, async (file) => { await client.request("remove", { path: file.path }) }) }
    return { mode: "fast", deleted_paths: paths }
  },
  async batchDelete(serverID, paths) {
    const success: string[] = [], failed: { path: string; error: string; message: string }[] = []
    for (const path of paths) { try { await browserSftpApi.delete(serverID, path); success.push(path) } catch (e) { failed.push({ path, error: "delete_failed", message: String(e) }) } }
    return { success, failed, total: paths.length }
  },
  async rename(serverID, path, destination) { return connectedSSH(serverID).request("rename", { path, destination }) },
  async chmod(serverID, path, mode) { return connectedSSH(serverID).request("chmod", { path, mode }) },
  async readFile(serverID, path) { return new TextDecoder("utf-8", { fatal: true }).decode(await read(connectedSSH(serverID), path, 8 << 20)) },
  async writeFile(serverID, path, content) { return upload(connectedSSH(serverID), path, new Blob([content]), undefined, undefined, true) },
  async closeConnection(serverID) { standalone.get(serverID)?.disconnect(); standalone.delete(serverID) },
  async uploadFile(serverID, path, file, onProgress, id) {
    const t = task(id); t.file_name = file.name; t.server_id = serverID; t.remote_path = join(path, file.name); t.file_size = file.size
    return run(t, () => upload(connectedSSH(serverID), t.remote_path!, file, t.id, onProgress))
  },
  async downloadFile(serverID, path, id) {
    const t = task(id, "download"); t.file_name = basename(path); t.server_id = serverID
    await run(t, async () => { const bytes = await read(connectedSSH(serverID), path, 256 << 20, t.id); check(t.id); download(new Blob([bytes as Uint8Array<ArrayBuffer>]), t.file_name) })
  },
  async batchDownload(serverID, paths, _mode, excludes, id) {
    const t = task(id, "download")
    await run(t, async () => {
      const client = connectedSSH(serverID), entries: { name: string; bytes: Uint8Array }[] = []
      let total = 0
      const patterns = (excludes || []).map((pattern) => new RegExp("^" + pattern.replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"))
      for (const selected of paths) { const root = await client.request<string>("realpath", { path: selected }); await walk(client, root, async (file) => {
        check(t.id)
        if (file.is_link) throw new Error("批量下载不跟随符号链接")
        if (file.is_dir || patterns.some((p) => p.test(file.name))) return
        const bytes = await read(client, file.path, (256 << 20) - total, t.id); total += bytes.length
        entries.push({ name: basename(root) + file.path.slice(root.length), bytes })
      }) }
      check(t.id); download(zipFiles(entries), "files.zip")
    })
  },
  async directTransfer(sourceID, sourcePath, targetID, targetPath, options) {
    const source = connectedSSH(sourceID), target = connectedSSH(targetID), t = task(options?.taskId, "transfer")
    t.file_name = basename(sourcePath); t.server_id = targetID
    void run(t, async () => {
      let totalLoaded = 0
      const copyFile = async (sourcePath: string, targetPath: string) => {
      const opened = await source.request<{ handle: string; size: number }>("download_open", { path: sourcePath })
      const temporary = `${targetPath}.easyssh-${t.id}.part`
      let destination: { handle: string } | undefined, committed = false
      try {
        destination = await target.request("upload_open", { path: temporary })
        let offset = 0
        while (true) { check(t.id); const chunk = await source.request<{ data: string; eof: boolean }>("download_chunk", { handle: opened.handle, offset }); const length = decodeBytes(chunk.data).length
          if (length) await target.request("upload_chunk", { handle: destination!.handle, offset, data: chunk.data })
          offset += length; progress(t, totalLoaded + offset, Math.max(t.total, totalLoaded + opened.size)); if (chunk.eof) break; if (!length) throw new Error("传输没有进展")
        }
        await target.request("file_close", { handle: destination!.handle }); check(t.id)
        await target.request("rename", { path: temporary, destination: targetPath }); committed = true; totalLoaded += offset
      } finally {
        await source.request("file_close", { handle: opened.handle }).catch(() => {})
        if (destination) { await target.request("file_close", { handle: destination.handle }).catch(() => {}); if (!committed) await target.request("remove", { path: temporary }).catch(() => {}) }
      }
      }
      const root = await source.request<string>("realpath", { path: sourcePath })
      targetPath = join(await target.request<string>("realpath", { path: targetPath }), basename(root))
      if (!targetPath || targetPath.split("/").includes("..") || (sourceID === targetID && (targetPath === root || targetPath.startsWith(root + "/")))) throw new Error("目标路径无效或位于源目录中")
      const copy = async (from: string, to: string, depth = 0, budget = { count: 0 }): Promise<void> => {
        check(t.id)
        if (depth > 64 || ++budget.count > 10000) throw new Error("目录层级或文件数量超出限制")
        const info = await source.request<FileInfo>("stat", { path: from })
        if (info.is_link) throw new Error("跨服务器传输不跟随符号链接")
        if (!info.is_dir) { await copyFile(from, to); return }
        await target.request("mkdir", { path: to })
        const listing = await source.request<{ files: FileInfo[] }>("list_directory", { path: from })
        for (const child of listing.files) await copy(child.path, join(to, child.name), depth + 1, budget)
      }
      await copy(root, targetPath)
    }).catch(() => {})
    return { success: true, task_id: t.id, message: "文件经本机加密 SSH 通道传输" }
  },
}
if (typeof window !== "undefined") window.addEventListener("easyssh:workspace-locked", () => { for (const t of tasks.values()) if (!["completed", "failed", "cancelled"].includes(t.status)) cancelled.add(t.id); tasks.clear(); for (const terminal of standalone.values()) terminal.disconnect(); standalone.clear() })
