import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { error, log } from "node:console"
import { exit } from "node:process"

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = resolve(scriptDir, "../..")

const rules = [
  {
    name: "Desktop frontend must not import Web Dashboard/API modules",
    root: "desktop/EasySSHDesktop/frontend/src",
    include: [".ts", ".tsx"],
    forbidden: [
      /from\s+["']@\/pages\/dashboard\//,
      /from\s+["']@\/lib\/api(?:\/|["'])/,
      /import\(["']@\/pages\/dashboard\//,
      /import\(["']@\/lib\/api(?:\/|["'])/,
    ],
  },
  {
    name: "Workspace package must not expose Web Shell or API modules",
    root: "web/packages/ssh-workspace/src",
    include: [".ts", ".tsx"],
    forbidden: [
      /from\s+["']@\/pages(?:\/|["'])/,
      /from\s+["']@\/layouts(?:\/|["'])/,
      /from\s+["']@\/lib\/api(?:\/|["'])/,
      /from\s+["'].+\/src\/pages(?:\/|["'])/,
      /from\s+["'].+\/src\/layouts(?:\/|["'])/,
      /from\s+["'].+\/src\/lib\/api(?:\/|["'])/,
      /import\(["']@\/pages(?:\/|["'])/,
      /import\(["']@\/layouts(?:\/|["'])/,
      /import\(["']@\/lib\/api(?:\/|["'])/,
    ],
  },
  {
    name: "Shared Workspace UI must not import Web API or Wails modules",
    root: "web/src/components/ssh-workspace",
    include: [".ts", ".tsx"],
    forbidden: [
      /from\s+["']@\/lib\/api(?:\/|["'])/,
      /from\s+["']@wailsio\//,
      /from\s+["'].+\/bindings(?:\/|["'])/,
      /import\(["']@\/lib\/api(?:\/|["'])/,
      /import\(["']@wailsio\//,
      /import\(["'].+\/bindings(?:\/|["'])/,
    ],
  },
]

type BoundaryFailure = {
  rule: string
  file: string
  line: number
  text: string
}

const failures: BoundaryFailure[] = []

for (const rule of rules) {
  const root = resolve(repoRoot, rule.root)
  for (const file of listFiles(root, rule.include)) {
    const source = readFileSync(file, "utf8")
    const lines = source.split(/\r?\n/)

    lines.forEach((line, index) => {
      if (rule.forbidden.some((pattern) => pattern.test(line))) {
        failures.push({
          rule: rule.name,
          file: relative(repoRoot, file),
          line: index + 1,
          text: line.trim(),
        })
      }
    })
  }
}

if (failures.length > 0) {
  error("Workspace boundary check failed:\n")
  for (const failure of failures) {
    error(`${failure.file}:${failure.line}`)
    error(`  ${failure.rule}`)
    error(`  ${failure.text}\n`)
  }
  exit(1)
}

log("Workspace boundary check passed.")

function listFiles(root: string, extensions: string[]) {
  const files: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stats = statSync(path)

      if (stats.isDirectory()) {
        walk(path)
      } else if (stats.isFile() && extensions.some((extension) => path.endsWith(extension))) {
        files.push(path)
      }
    }
  }

  walk(root)
  return files
}
