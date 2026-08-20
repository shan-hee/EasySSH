import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const version = readFileSync(join(projectRoot, "VERSION"), "utf-8").trim()
if (!version) {
  throw new Error("VERSION 文件内容为空")
}

const buildDate = new Date().toISOString()

function parsePort(value: string | undefined) {
  if (!value) return undefined
  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, projectRoot, ""),
    ...process.env,
  }
  const webPort = parsePort(env.WEB_PORT)

  return {
    envDir: "..",
    plugins: [react()],
    server: webPort
      ? {
          port: webPort,
          strictPort: true,
        }
      : undefined,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@easyssh/ssh-workspace": fileURLToPath(
          new URL("./packages/ssh-workspace/src/index.ts", import.meta.url),
        ),
        "@protobufjs/inquire": fileURLToPath(
          new URL("./src/lib/proto/browser-inquire.cjs", import.meta.url),
        ),
      },
    },
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      "import.meta.env.VITE_BUILD_DATE": JSON.stringify(buildDate),
    },
    build: {
      reportCompressedSize: false,
    },
  }
})
