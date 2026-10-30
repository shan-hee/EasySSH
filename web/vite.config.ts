import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import { appSingletonDependencies, appSourceAliases } from "@easyssh/app/vite"
import { chunkOutput } from "@easyssh/frontend-tooling/code-splitting"
import { precompress } from "./plugins/precompress.ts"

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
  // 开发时经同源代理访问后端，所有者 Cookie、CSRF 与 WebSocket 票据和生产部署行为一致。
  const backendURL = env.VITE_BACKEND_URL?.trim() || "http://localhost:8520"

  return {
    envDir: "..",
    plugins: [react(), precompress()],
    server: {
      ...(webPort ? { port: webPort, strictPort: true } : {}),
      proxy: {
        "/api": { target: backendURL, ws: true },
      },
    },
    resolve: {
      dedupe: appSingletonDependencies,
      alias: appSourceAliases,
    },
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      "import.meta.env.VITE_BUILD_DATE": JSON.stringify(buildDate),
    },
    build: {
      reportCompressedSize: true,
      rolldownOptions: {
        output: chunkOutput,
      },
    },
  }
})
