import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const projectDirectory = fileURLToPath(new URL("../", import.meta.url))
const bindingsDirectory = fileURLToPath(new URL("../frontend/bindings", import.meta.url))
const windows = process.platform === "win32"

// Wails' temporary-directory rename fails on Windows. Remove the fixed output
// directory first, then generate in place so retired bindings cannot survive.
if (windows) {
  rmSync(bindingsDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

const result = spawnSync("wails3", [
  "generate", "bindings", `-clean=${!windows}`, ...process.argv.slice(2),
], { cwd: projectDirectory, stdio: "inherit" })

if (result.error) {
  console.error(result.error.message)
}
process.exit(result.status ?? 1)
