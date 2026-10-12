// Explicit build entry point. Also used by the Web build; never run at startup.
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, "web", "public", "browser-ssh")
mkdirSync(output, { recursive: true })
const goRoot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim()
for (const [name, command] of [["ssh", "browser-ssh"], ["crypto", "client-crypto"]]) {
execFileSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", join(output, `${name}.wasm.tmp`), `./cmd/${command}`], {
  cwd: join(root, "shared"),
  env: { ...process.env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
  stdio: "inherit",
})
renameSync(join(output, `${name}.wasm.tmp`), join(output, `${name}.wasm`))
}
copyFileSync(join(goRoot, "lib", "wasm", "wasm_exec.js"), join(output, "wasm_exec.js"))
