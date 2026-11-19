// 应用版本的唯一来源是 vX.Y.Z 标签；仓库内不保存版本号。
//   check          校验迁移规则，并保证最近已发布标签的 SQL 未被改写（CI 每次推送）
//   release x.y.z  在 check 基础上校验新版本高于既有标签（打标签前、标签流水线）
//   stamp x.y.z    把版本写入桌面打包资产（仅在 CI 构建工作区执行，不提交）
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

function checkMigrations(schema, baseline) {
  const migrationRoot = schema.root
  const declared = Number(read(`${migrationRoot}/schema.go`).match(latestPattern)?.[1])
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
  if (declared !== latest) fail(`${schema.name} schema.Version=${declared} 与最新迁移 ${latest} 不一致；请使用 scripts/new-migration.mjs 新增迁移`)
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
  console.log(`${schema.name} 数据库：各方言迁移连续一致，版本 ${latest}${baseline ? `；${baseline} 已发布 SQL 保持不变` : ""}`)
}

// 打包资产在仓库中保留 0.0.0 占位，发布构建前按标签写入；字段缺失或重复即失败。
function stamp(target) {
  const [major, minor, patch] = versionParts(target)
  const fields = [
    [`${desktop}/build/config.yml`, /^  version: "[^"]*"/gm, `  version: "${target}"`, 1],
    [`${desktop}/build/windows/info.json`, /"(file_version|ProductVersion)"(\s*:\s*)"[^"]*"/g, (_, key, sep) => `"${key}"${sep}"${target}"`, 2],
    [`${desktop}/build/windows/nsis/wails_tools.nsh`, /!define INFO_PRODUCTVERSION "[^"]*"/g, `!define INFO_PRODUCTVERSION "${target}"`, 1],
    [`${desktop}/build/windows/msix/app_manifest.xml`, /\bVersion="[^"]*"/g, `Version="${major}.${minor}.${patch}.0"`, 1],
    [`${desktop}/build/windows/msix/template.xml`, /\bVersion="[^"]*"/g, `Version="${major}.${minor}.${patch}.0"`, 1],
    [`${desktop}/build/darwin/Info.plist`, /(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]*/g, `$1${target}`, 2],
    [`${desktop}/build/darwin/Info.dev.plist`, /(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]*/g, `$1${target}`, 2],
    [`${desktop}/build/linux/nfpm/nfpm.yaml`, /^version: "[^"]*"/gm, `version: "${target}"`, 1],
  ]
  const files = fields.map(([name, pattern, replacement, count]) => {
    const before = read(name)
    if ((before.match(pattern) ?? []).length !== count) fail(`${name} 的版本字段缺失或重复`)
    return [name, before.replace(pattern, replacement)]
  })
  for (const [name, content] of files) fs.writeFileSync(path.join(root, name), content)
  console.log(`已写入 ${files.length} 个桌面打包资产版本：${target}`)
}

try {
  const [mode, requested, ...extra] = process.argv.slice(2)
  if (!["check", "release", "stamp"].includes(mode) || extra.length || (mode === "check") !== (requested === undefined)) fail("用法：node scripts/release-version.mjs check | release x.y.z | stamp x.y.z")
  if (mode === "stamp") stamp(requested)
  else {
    let tags = releaseTags()
    if (mode === "release") {
      versionParts(requested)
      const tag = `v${requested}`
      // 标签流水线中新标签已指向 HEAD；本地打标签前它还不存在。
      if (git("tag", "--list", tag) && git("rev-list", "-n", "1", tag) !== git("rev-parse", "HEAD")) fail(`标签 ${tag} 已存在且不指向当前提交`)
      tags = tags.filter(name => name !== tag)
      if (tags.length && compare(requested, tags[0].slice(1)) <= 0) fail(`新版本 ${requested} 必须高于已发布版本 ${tags[0].slice(1)}`)
    }
    for (const schema of schemas) checkMigrations(schema, tags[0])
  }
} catch (error) {
  console.error(`版本检查失败：${error.message}`)
  process.exitCode = 1
}
