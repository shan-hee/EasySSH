import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"

let version = "1.0.0"

try {
  version = readFileSync(join(__dirname, "..", "VERSION"), "utf-8").trim()
} catch {
  console.warn("无法读取 VERSION 文件，使用默认版本:", version)
}

const buildDate = new Date().toISOString()

function parsePort(value: string | undefined) {
  if (!value) return undefined
  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, join(__dirname, ".."), ""),
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
      },
    },
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      "import.meta.env.VITE_BUILD_DATE": JSON.stringify(buildDate),
    },
  }
})
