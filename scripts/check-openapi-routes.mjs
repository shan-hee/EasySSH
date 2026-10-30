import fs from "node:fs"

const main = fs.readFileSync(new URL("../server/cmd/api/main.go", import.meta.url), "utf8")
const spec = fs.readFileSync(new URL("../contracts/http/openapi.yaml", import.meta.url), "utf8")

const prefixes = new Map([["v1", ""]])
const groups = [...main.matchAll(/\b(\w+)\s*:=\s*(\w+)\.Group\(\s*"([^"]*)"\s*(?:,|\))/g)]
let changed = true
while (changed) {
  changed = false
  for (const [, name, parent, path] of groups) {
    if (prefixes.has(name) || !prefixes.has(parent)) continue
    prefixes.set(name, `${prefixes.get(parent)}${path}`)
    changed = true
  }
}

// A group with middleware arguments is still a route group. Never silently
// discard a group merely because its parent/prefix could not be resolved.
const unresolvedGroups = groups.filter(([, name]) => !prefixes.has(name)).map(([, name]) => name)
if (unresolvedGroups.length) {
  console.error(`无法解析路由组前缀: ${unresolvedGroups.join(", ")}`)
  process.exit(1)
}

const runtimeOperations = new Set()
for (const match of main.matchAll(/\b(\w+)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\s*"([^"]*)"/g)) {
  const prefix = prefixes.get(match[1])
  if (prefix === undefined) continue
  const path = `${prefix}${match[3]}`.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
  runtimeOperations.add(`${match[2]} ${path}`)
}

const contractOperations = new Set()
const operationIds = new Set()
const duplicateOperationIds = new Set()
let currentPath
for (const line of spec.split(/\r?\n/)) {
  const pathMatch = line.match(/^  (\/.*):$/)
  if (pathMatch) {
    currentPath = pathMatch[1]
    continue
  }
  const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options):$/)
  if (currentPath && methodMatch) {
    contractOperations.add(`${methodMatch[1].toUpperCase()} ${currentPath}`)
  }
  const operationIdMatch = line.match(/^      operationId: (\S+)$/)
  if (operationIdMatch) {
    if (operationIds.has(operationIdMatch[1])) duplicateOperationIds.add(operationIdMatch[1])
    operationIds.add(operationIdMatch[1])
  }
}

const missing = [...runtimeOperations].filter((operation) => !contractOperations.has(operation)).sort()
const stale = [...contractOperations].filter((operation) => !runtimeOperations.has(operation)).sort()
const missingOperationIds = contractOperations.size - operationIds.size

if (missing.length || stale.length || duplicateOperationIds.size || missingOperationIds) {
  console.error(`运行时 ${runtimeOperations.size} 个操作；契约 ${contractOperations.size} 个操作；缺少 ${missing.length}，过时 ${stale.length}`)
  if (missing.length) console.error(`OpenAPI 缺少运行时操作:\n${missing.join("\n")}`)
  if (stale.length) console.error(`OpenAPI 存在无运行时路由的操作:\n${stale.join("\n")}`)
  if (duplicateOperationIds.size) {
    console.error(`OpenAPI operationId 重复:\n${[...duplicateOperationIds].sort().join("\n")}`)
  }
  if (missingOperationIds) console.error(`OpenAPI 有 ${missingOperationIds} 个操作缺少 operationId`)
  process.exit(1)
}

console.log(`✅ OpenAPI 路由一致：${runtimeOperations.size} 个操作`)
