/** 待上传的本机文件夹；路径相对文件夹本身，目录总在其父目录之后列出。 */
export interface UploadFolder {
  name: string
  directories: string[]
  files: UploadFolderFile[]
}

export interface UploadFolderFile {
  path: string
  file: File
}

const FOLDER_BUNDLE_MAGIC = "EASYSSH-FOLDER-1\n"

/**
 * 文件夹包：魔数、4 字节大端清单长度、JSON 清单，随后按清单顺序拼接文件内容。
 * 由 Blob 片段组成，发送时才按需读取文件，大小在发送前即可精确得到。
 */
export function createFolderBundle(folder: UploadFolder): Blob {
  const encoder = new TextEncoder()
  const manifest = encoder.encode(JSON.stringify({
    directories: folder.directories,
    files: folder.files.map(({ path, file }) => ({ path, size: file.size })),
  }))
  const magic = encoder.encode(FOLDER_BUNDLE_MAGIC)
  const prefix = new Uint8Array(magic.length + 4)
  prefix.set(magic)
  new DataView(prefix.buffer).setUint32(magic.length, manifest.byteLength)
  return new Blob([prefix, manifest, ...folder.files.map(({ file }) => file)], { type: "application/octet-stream" })
}

export function uploadFolderSize(folder: UploadFolder): number {
  return folder.files.reduce((total, { file }) => total + file.size, 0)
}

/** 由 `<input webkitdirectory>` 的选择得到文件夹；浏览器不提供其中的空目录。 */
export function uploadFoldersFromInput(fileList: FileList): UploadFolder[] {
  const folders = new Map<string, { directories: Set<string>; files: UploadFolderFile[] }>()
  for (const file of Array.from(fileList)) {
    const [root, ...parts] = file.webkitRelativePath.split("/")
    if (!root || parts.length === 0) continue
    let folder = folders.get(root)
    if (!folder) {
      folder = { directories: new Set(), files: [] }
      folders.set(root, folder)
    }
    // Set 保持插入顺序，逐级加入祖先目录即保证父目录在前。
    for (let depth = 1; depth < parts.length; depth++) {
      folder.directories.add(parts.slice(0, depth).join("/"))
    }
    folder.files.push({ path: parts.join("/"), file })
  }
  return Array.from(folders, ([name, folder]) => ({ name, directories: Array.from(folder.directories), files: folder.files }))
}

/** 取得拖入项的条目；DataTransfer 只在 drop 事件内可读，必须在事件处理中同步调用。 */
export function takeDroppedEntries(items: readonly DataTransferItem[]): FileSystemEntry[] {
  return items
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
}

/** 展开拖入的条目：文件夹逐级读取为待上传文件夹，普通文件原样返回。 */
export async function readDroppedEntries(entries: readonly FileSystemEntry[]): Promise<{ files: File[]; folders: UploadFolder[] }> {
  const files: File[] = []
  const folders: UploadFolder[] = []
  for (const entry of entries) {
    if (isDirectoryEntry(entry)) {
      folders.push(await readFolder(entry))
    } else if (isFileEntry(entry)) {
      files.push(await readFile(entry))
    }
  }
  return { files, folders }
}

async function readFolder(root: FileSystemDirectoryEntry): Promise<UploadFolder> {
  const folder: UploadFolder = { name: root.name, directories: [], files: [] }
  const visit = async (directory: FileSystemDirectoryEntry, prefix: string) => {
    for (const entry of await readDirectory(directory)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isDirectoryEntry(entry)) {
        folder.directories.push(path)
        await visit(entry, path)
      } else if (isFileEntry(entry)) {
        folder.files.push({ path, file: await readFile(entry) })
      }
    }
  }
  await visit(root, "")
  return folder
}

async function readDirectory(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader()
  const entries: FileSystemEntry[] = []
  // Chromium 每次最多返回 100 项，读到空批次才算读完。
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}
