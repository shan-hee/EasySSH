import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import type { Plugin } from "vite"

// 在构建时压缩，避免弱网请求到达时再占用服务端 CPU。
export function precompress(): Plugin {
  return {
    name: "easyssh-precompress",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (!/\.(?:js|css|html|svg|json)$/.test(output.fileName)) continue

          const source = output.type === "chunk" ? output.code : output.source
          const bytes = typeof source === "string" ? Buffer.from(source) : source
          if (bytes.byteLength < 1024) continue

          const variants = {
            gz: gzipSync(bytes, { level: 9 }),
            br: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
          }
          for (const [extension, compressed] of Object.entries(variants)) {
            if (compressed.byteLength >= bytes.byteLength) continue
            this.emitFile({
              type: "asset",
              fileName: `${output.fileName}.${extension}`,
              source: compressed,
            })
          }
        }
      },
    },
  }
}
