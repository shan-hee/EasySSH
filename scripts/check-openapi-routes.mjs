import fs from "node:fs"

const main = fs.readFileSync("server/cmd/api/main.go", "utf8")
const spec = fs.readFileSync("shared/openapi.yaml", "utf8")

const prefixes = new Map([["v1", ""]])
const groups = [...main.matchAll(/\b(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"\)/g)]
let changed = true
while (changed) {
  changed = false
  for (const [, name, parent, path] of groups) {
    if (prefixes.has(name) || !prefixes.has(parent)) continue
    prefixes.set(name, `${prefixes.get(parent)}${path}`)
    changed = true
  }
}

const runtimeOperations = new Set()
for (const match of main.matchAll(/\b(\w+)\.(GET|POST|PUT|PATCH|DELETE|HEAD)\(\s*"([^"]*)"/g)) {
  const prefix = prefixes.get(match[1])
  if (prefix === undefined) continue
  const path = `${prefix}${match[3]}`.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
  runtimeOperations.add(`${match[2]} ${path}`)
}

const contractOperations = new Set()
const operationIds = new Set()
const duplicateOperationIds = new Set()
let currentPath
for (const line of spec.split("\n")) {
  const pathMatch = line.match(/^  (\/.*):$/)
  if (pathMatch) {
    currentPath = pathMatch[1]
    continue
  }
  const methodMatch = line.match(/^    (get|post|put|patch|delete|head):$/)
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
  if (missing.length) console.error(`OpenAPI 缺少运行时操作:\n${missing.join("\n")}`)
  if (stale.length) console.error(`OpenAPI 存在无运行时路由的操作:\n${stale.join("\n")}`)
  if (duplicateOperationIds.size) {
    console.error(`OpenAPI operationId 重复:\n${[...duplicateOperationIds].sort().join("\n")}`)
  }
  if (missingOperationIds) console.error(`OpenAPI 有 ${missingOperationIds} 个操作缺少 operationId`)
  process.exit(1)
}

console.log(`✅ OpenAPI 路由一致：${runtimeOperations.size} 个操作`)
