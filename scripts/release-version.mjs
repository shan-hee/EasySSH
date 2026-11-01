import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const desktop = "desktop/EasySSHDesktop"
const schemas = [
  { name: "server", root: "server/internal/storage/schema", tracks: ["sqlite", "postgres", "mysql"] },
  { name: "desktop", root: `${desktop}/internal/storage/schema`, tracks: ["sqlite"] },
]
const latestPattern = /^const Version int64 = (\d+)$/m
const normalize = text => text.replace(/\r\n/g, "\n")
const read = name => fs.readFileSync(path.join(root, name), "utf8")
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trimEnd()
const fail = message => { throw new Error(message) }

function versionParts(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) fail(`版本号必须为 x.y.z，且不能含前导零：${value}`)
  const parts = value.split(".").map(Number)
  if (parts.some(part => part > 65535)) fail("版本号各段不能超过 65535（Windows 安装包限制）")
  return parts
}

function compare(a, b) {
  const left = versionParts(a), right = versionParts(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}

function releaseTags() {
  if (git("rev-parse", "--is-shallow-repository") === "true") fail("发布检查需要完整 Git 历史和标签；请先获取完整历史（git fetch --unshallow --tags）。")
  return git("tag", "--merged", "HEAD", "--list", "v*").split("\n")
    .filter(tag => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .sort((a, b) => compare(b.slice(1), a.slice(1)))
}

function checkMigrations(schema, version, tags, prepare, includeCurrent) {
  const migrationRoot = schema.root
  const latestFile = `${migrationRoot}/schema.go`
  const source = read(latestFile)
  const declared = Number(source.match(latestPattern)?.[1])
  if (!Number.isSafeInteger(declared) || declared < 1) fail(`无法读取 ${schema.name} schema.Version`)
  let expected
  let expectedNames
  for (const track of schema.tracks) {
    const directory = `${migrationRoot}/${track}`
    const names = fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith(".sql")).sort()
    if (!names.length) fail(`${track} 缺少初始化基线`)
    const numbers = []
    for (const [index, name] of names.entries()) {
      const match = /^(\d{5})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.sql$/.exec(name)
      if (!match) fail(`${track} 迁移文件名无效：${name}`)
      const number = Number(match[1])
      if (!Number.isSafeInteger(number) || number < 1) fail(`${track} 迁移编号无效`)
      if ((index === 0) !== (match[2] === "initial")) fail(`${track} 必须保留一个初始化基线，其后只追加升级迁移`)
      if (index === 0 && name !== "00001_initial.sql") fail(`${track} 初始化基线必须为 00001_initial.sql`)
      if (index > 0 && number !== numbers[index - 1] + 1) fail(`${track} 迁移编号必须连续且不能重复`)
      numbers.push(number)
      const text = normalize(read(`${directory}/${name}`))
      const up = [...text.matchAll(/^-- \+goose Up\s*$/gm)]
      const down = [...text.matchAll(/^-- \+goose Down\s*$/gm)]
      if (up.length !== 1 || down.length !== (index === 0 ? 0 : 1) || (down.length && down[0].index < up[0].index)) fail(`${track}/${name} 必须包含一个 Up 段，升级迁移还必须提供 Down 回滚段`)
      const hasSQL = section => section.replace(/--[^\n]*/g, "").trim().length > 0
      if (!hasSQL(text.slice(up[0].index + up[0][0].length, down[0]?.index)) || (down.length && !hasSQL(text.slice(down[0].index + down[0][0].length)))) fail(`${track}/${name} 迁移 SQL 不能为空`)
    }
    if (expected && JSON.stringify(numbers) !== JSON.stringify(expected)) fail(`${track} 的迁移编号与其他数据库不一致`)
    if (expectedNames && JSON.stringify(names) !== JSON.stringify(expectedNames)) fail(`${track} 的迁移名称与其他数据库不一致`)
    expected = numbers
    expectedNames = names
  }
  const latest = expected.at(-1)
  if (declared > latest) fail(`${schema.name} schema.Version=${declared}，不能降低数据库版本`)
  if (!prepare && declared !== latest) fail(`${schema.name} schema.Version=${declared} 与最新迁移 ${latest} 不一致`)
  const baseline = tags.find(tag => compare(tag.slice(1), version) < 0 || (includeCurrent && tag.slice(1) === version))
  if (baseline) {
    const files = git("ls-tree", "-r", "--name-only", baseline, "--", migrationRoot).split("\n").filter(name => name.endsWith(".sql"))
    for (const name of files) {
      if (!fs.existsSync(path.join(root, name))) fail(`禁止删除或重命名 ${baseline} 已发布迁移：${name}`)
      const published = execFileSync("git", ["show", `${baseline}:${name}`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      if (normalize(read(name)) !== normalize(published)) fail(`禁止改写 ${baseline} 已发布迁移：${name}；请追加新的升级迁移`)
    }
    // Do not insert migrations below a released version, even if the sequence
    // would be contiguous: deployed databases would silently skip them.
    for (const track of schema.tracks) {
      const prefix = `${migrationRoot}/${track}/`
      const released = files.filter(name => name.startsWith(prefix))
      const ceiling = Math.max(0, ...released.map(name => Number(path.basename(name).split("_")[0])))
      for (const name of fs.readdirSync(path.join(root, migrationRoot, track)).filter(name => name.endsWith(".sql"))) {
        if (Number(name.split("_")[0]) <= ceiling && !released.includes(prefix + name)) fail(`禁止在 ${baseline} 已发布版本之前插入迁移：${prefix + name}`)
      }
    }
  }
  console.log(`${schema.name} 数据库：各方言迁移连续一致，版本 ${latest}；已发布 SQL 保持不变`)
  return { latestFile, latest, source }
}

// Validate every version source before making any writes. Replacing these fields
// does not run npm lifecycle hooks, dependency installation, builds or migrations.
function versionFiles(current, target) {
  const files = new Map()
  const update = (name, pattern, expected, replacement, count = 1) => {
    const before = read(name)
    const matches = [...before.matchAll(pattern)]
    if (matches.length !== count || matches.some(match => match[1] !== expected)) fail(`${name} 的版本字段缺失、重复或与 VERSION 不一致`)
    files.set(name, before.replace(pattern, (...args) => args[0].replace(args[1], replacement)))
  }
  files.set("VERSION", `${target}\n`)
  for (const name of ["web/package.json", `${desktop}/frontend/package.json`]) {
    const source = read(name)
    if (JSON.parse(source).version !== current) fail(`${name} 的版本与 VERSION 不一致`)
    files.set(name, source.replace(/("version"\s*:\s*")[^"]+("\s*,?)/, (_, prefix, suffix) => `${prefix}${target}${suffix}`))
  }
  for (const name of ["web/package-lock.json", `${desktop}/frontend/package-lock.json`]) {
    if (!fs.existsSync(path.join(root, name))) continue
    const json = JSON.parse(read(name))
    if (json.version !== current || (json.packages?.[""] && json.packages[""].version !== current)) fail(`${name} 的根版本与 VERSION 不一致`)
    json.version = target
    if (json.packages?.[""]) json.packages[""].version = target
    files.set(name, `${JSON.stringify(json, null, 2)}\n`)
  }
  update(`${desktop}/internal/app/desktopversion.go`, /^const desktopBundledVersion = "([^"]+)"/gm, current, target)
  update(`${desktop}/build/config.yml`, /^  version: "([^"]+)"/gm, current, target)
  update(`${desktop}/build/windows/info.json`, /"(?:file_version|ProductVersion)"\s*:\s*"([^"]+)"/g, current, target, 2)
  for (const name of ["app_manifest.xml", "template.xml"]) update(`${desktop}/build/windows/msix/${name}`, /\bVersion="([^"]+)"/g, `${current}.0`, `${target}.0`)
  for (const name of ["Info.plist", "Info.dev.plist"]) update(`${desktop}/build/darwin/${name}`, /<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>([^<]+)<\/string>/g, current, target, 2)
  update(`${desktop}/build/linux/nfpm/nfpm.yaml`, /^version: "([^"]+)"/gm, current, target)
  // Keep generated comments and installer defaults in sync too.
  const oldVersion = new RegExp(`(?<![\\d.])${current.replaceAll(".", "\\.")}(?!\\d)`, "g")
  for (const name of git("ls-files", "--", `${desktop}/build`).split("\n")) {
    if (!/\.(?:yml|yaml|json|xml|plist|nsi|nsh)$/.test(name)) continue
    const before = read(name)
    if (before.includes(current)) files.set(name, (files.get(name) ?? before).replace(oldVersion, target))
  }
  const readme = read("README.md")
  files.set("README.md", readme.replace(/badge\/version-\d+\.\d+\.\d+-blue/g, `badge/version-${target}-blue`))
  return files
}

function writeFiles(files) {
  const originals = new Map([...files.keys()].map(name => [name, fs.readFileSync(path.join(root, name))]))
  const changed = []
  try {
    for (const [name, content] of files) {
      if (normalize(originals.get(name).toString("utf8")) === normalize(content)) continue
      changed.push(name)
      fs.writeFileSync(path.join(root, name), content)
    }
  } catch (error) {
    const failures = []
    for (const name of changed.reverse()) {
      try { fs.writeFileSync(path.join(root, name), originals.get(name)) }
      catch { failures.push(name) }
    }
    if (failures.length) fail(`${error.message}；回写失败，请检查：${failures.join(", ")}`)
    throw error
  }
  console.log(`已更新 ${changed.length} 个版本文件；没有连接数据库、构建或执行迁移。`)
}

try {
  const [mode = "--check", requested, ...extra] = process.argv.slice(2)
  if (!["--check", "--prepare", "--release"].includes(mode) || extra.length || (mode !== "--check" && !requested)) fail("用法：node scripts/release-version.mjs --check | --prepare x.y.z | --release x.y.z")
  const current = read("VERSION").trim()
  versionParts(current)
  const target = requested ?? current
  versionParts(target)
  const tags = releaseTags()
  if (mode === "--prepare") {
    if (git("status", "--porcelain")) fail("发版前请先提交业务代码、迁移 SQL 和其他改动；工作区及暂存区必须干净，避免标签遗漏代码。")
    if (compare(target, current) <= 0 || tags.some(tag => compare(tag.slice(1), target) >= 0)) fail("新版本必须高于当前 VERSION 和当前分支已有发布版本")
    if (git("tag", "--list", `v${target}`)) fail(`标签 v${target} 已存在`)
    // A release from detached HEAD cannot safely push the release commit.
    if (!git("branch", "--show-current")) fail("请先切换到发布分支，不要在 detached HEAD 上更新版本")
  } else if (current !== target) fail(`VERSION=${current} 与目标 ${target} 不一致`)
  if (mode === "--release" && tags.some(tag => compare(tag.slice(1), target) > 0)) fail("目标版本低于当前分支已有发布版本，拒绝倒退发布")
  const migrations = schemas.map(schema => checkMigrations(schema, target, tags, mode === "--prepare", mode === "--check"))
  const files = versionFiles(current, target)
  if (mode === "--prepare") {
    for (const { latestFile, source, latest } of migrations) {
      files.set(latestFile, source.replace(latestPattern, `const Version int64 = ${latest}`))
    }
    writeFiles(files)
  } else console.log(`应用版本一致：${current}；数据库版本：${migrations.map(({ latestFile, latest }) => `${latestFile}=${latest}`).join(", ")}`)
} catch (error) {
  console.error(`版本检查失败：${error.message}`)
  process.exitCode = 1
}
