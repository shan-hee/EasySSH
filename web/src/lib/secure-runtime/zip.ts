// Stored ZIP entries keep archive creation local and avoid a second full copy
// for compression. The caller bounds aggregate payload size before collecting.
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Blob {
  const parts: BlobPart[] = [], directory: BlobPart[] = []
  const names = new Set<string>()
  let offset = 0, directorySize = 0
  if (files.length > 65535) throw new Error("ZIP 文件数量过多")
  const table = Array.from({ length: 256 }, (_, i) => { let n = i; for (let b = 0; b < 8; b++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); return n >>> 0 })
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    if (!name.length || name.length > 65535 || /[\\:\x00-\x1f]/.test(file.name) || file.name.startsWith("/") || file.name.split("/").some((p) => !p || p === ".." || p === ".") || names.has(file.name)) throw new Error("ZIP 路径无效")
    names.add(file.name)
    let crc = 0xffffffff
    for (const byte of file.bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255]
    crc = (crc ^ 0xffffffff) >>> 0
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true)
    l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, file.bytes.length, true); l.setUint32(22, file.bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30)
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true)
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, file.bytes.length, true); c.setUint32(24, file.bytes.length, true)
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46)
    parts.push(local, new Blob([file.bytes as Uint8Array<ArrayBuffer>]))
    directory.push(central); offset += local.length + file.bytes.length; directorySize += central.length
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end], { type: "application/zip" })
}
