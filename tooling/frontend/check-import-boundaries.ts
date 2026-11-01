import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { exit } from "node:process"
import { error, log } from "node:console"

// 前端导入边界检查，覆盖共享应用包与 Web、桌面两端宿主。
// 凭据保存、刷新、CSRF 与网络地址属于宿主平台，共享包只依赖 contracts 中的契约。

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..")

const APP_ROOT = "packages/app"
const APP_SOURCE = `${APP_ROOT}/src`
const WEB_SOURCE = "web/src"
const DESKTOP_SOURCE = "desktop/EasySSHDesktop/frontend/src"

// 工作区核心：会话、传输与适配器契约，不依赖任何具体传输实现。
const workspaceCoreFiles = [
  "lib/session/terminal-types.ts",
  "lib/session/transfer-controller.ts",
  "lib/session/transfer-manager-controller.ts",
  "lib/session/transfer-runtime.ts",
  "lib/session/transfer-tasks.ts",
  "lib/session/types.ts",
  "lib/session/workspace-adapters.ts",
  "lib/session/workspace-settings.ts",
  "lib/session/workspace.ts",
  "lib/sftp-types.ts",
  "components/ssh-workspace/ssh-workspace.tsx",
  "components/ssh-workspace/use-workspace-translator.ts",
].map((file) => `${APP_SOURCE}/${file}`)

type ImportRecord = {
  file: string
  line: number
  specifier: string
  // 相对导入解析后的仓库相对路径；包名导入为 null。
  target: string | null
}

type Rule = {
  name: string
  roots: string[]
  violates: (record: ImportRecord) => boolean
}

const isWithin = (path: string | null, root: string) => path !== null && (path === root || path.startsWith(`${root}/`))

const rules: Rule[] = [
  {
    name: "Base UI primitives must not depend on animation enhancement layers",
    roots: [`${APP_SOURCE}/components/ui`],
    // Modal primitives own the shared Radix/Motion lifecycle. Other primitives
    // still cannot pull in Motion or application-level enhancement components.
    violates: ({ file, specifier }) =>
      (/^motion(?:\/react)?$/.test(specifier) && !/^packages\/app\/src\/components\/ui\/(?:dialog|alert-dialog|sheet|modal-motion)\.tsx$/.test(file))
      || /^@\/components\/(?:motion|animate-ui)(?:\/|$)/.test(specifier),
  },
  {
    name: "Shared app must not import Wails, host applications or other packages by path",
    roots: [APP_SOURCE],
    violates: ({ specifier, target }) =>
      specifier.startsWith("@wailsio/")
      || /(?:^|\/)bindings(?:\/|$)/.test(specifier)
      || specifier === "@easyssh/app"
      || specifier.startsWith("@easyssh/app/")
      || (target !== null && !isWithin(target, APP_ROOT)),
  },
  {
    name: "Workspace core must not depend on concrete Web transport",
    roots: workspaceCoreFiles,
    violates: ({ specifier }) => /^@\/(?:lib\/api(?:-client)?|contracts\/platform-transport)(?:\/|$)/.test(specifier),
  },
  {
    name: "Hosts must use @easyssh/app exports instead of its internal alias or paths",
    roots: [WEB_SOURCE, DESKTOP_SOURCE],
    violates: ({ file, specifier, target }) =>
      specifier.startsWith("@/")
      || specifier.includes("node_modules/")
      || (target !== null && !isWithin(target, hostRoot(file))),
  },
  {
    name: "Sync document logic must stay host-independent; Automerge is injected by each host",
    roots: ["packages/sync-document"],
    violates: () => true,
  },
  {
    name: "Desktop must not import Web dashboard pages or owner API clients",
    roots: [DESKTOP_SOURCE],
    // The isolated remote window installs a native PlatformTransport. Only its
    // file/connection protocol clients may use that explicit endpoint dispatcher.
    violates: ({ file, specifier }) => /^@easyssh\/app\/(?:pages|lib\/api)(?:\/|$)/.test(specifier)
      && !(isWithin(file, `${DESKTOP_SOURCE}/remote`) && /^@easyssh\/app\/lib\/api\/(?:connections|sftp)$/.test(specifier)),
  },
]

function hostRoot(file: string) {
  return isWithin(file, WEB_SOURCE) ? "web" : "desktop/EasySSHDesktop/frontend"
}

const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|@import\s+)["']([^"']+)["']/g

function collectImports(file: string): ImportRecord[] {
  const records: ImportRecord[] = []
  const lines = readFileSync(join(repoRoot, file), "utf8").split(/\r?\n/)
  lines.forEach((text, index) => {
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1]
      const target = specifier.startsWith(".")
        ? relative(repoRoot, resolve(repoRoot, dirname(file), specifier)).split(sep).join("/")
        : null
      records.push({ file, line: index + 1, specifier, target })
    }
  })
  return records
}

function listSourceFiles(root: string): string[] {
  const absolute = join(repoRoot, root)
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [root]
  const files: string[] = []
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules") continue
    files.push(...listSourceFiles(`${root}/${entry}`))
  }
  return files.filter((file) => /\.(?:tsx?|mts|mjs|css)$/.test(file))
}

const failures: string[] = []

for (const rule of rules) {
  for (const root of rule.roots) {
    for (const file of listSourceFiles(root)) {
      for (const record of collectImports(file)) {
        if (rule.violates(record)) {
          failures.push(`${record.file}:${record.line}\n  ${rule.name}\n  ${record.specifier}`)
        }
      }
    }
  }
}

if (failures.length > 0) {
  error("Import boundary check failed:\n")
  for (const failure of failures) error(`${failure}\n`)
  exit(1)
}

log("Import boundary check passed.")
