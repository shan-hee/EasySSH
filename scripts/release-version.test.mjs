import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"

const source = fileURLToPath(new URL("../", import.meta.url))
const current = "1.0.0"
const next = "1.0.1"
const schema = Number(fs.readFileSync(path.join(source, "server/internal/storage/schema/schema.go"), "utf8").match(/const Version int64 = (\d+)/)[1])
const desktopSchema = Number(fs.readFileSync(path.join(source, "desktop/EasySSHDesktop/internal/storage/schema/schema.go"), "utf8").match(/const Version int64 = (\d+)/)[1])
const migrationName = (number, suffix) => `${String(number).padStart(5, "0")}_${suffix}.sql`
const serverTracks = ["server/internal/storage/schema/sqlite", "server/internal/storage/schema/postgres", "server/internal/storage/schema/mysql"]
const desktopTrack = "desktop/EasySSHDesktop/internal/storage/schema/sqlite"
const migration = "-- +goose Up\nSELECT 1;\n-- +goose Down\nSELECT 1;\n"
const baseline = "00001_initial.sql"

function fixture(t) {
  const prefix = path.join(os.tmpdir(), "easyssh-release-check-")
  const root = fs.mkdtempSync(prefix)
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(prefix))) throw new Error("unexpected fixture path")
    fs.rmSync(root, { recursive: true, force: true })
  })
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "desktop/EasySSHDesktop/build", "server/internal/storage/schema", "desktop/EasySSHDesktop/internal/storage/schema"], { cwd: source, encoding: "utf8" })
    .trim().split("\n").filter(name => /\.(?:go|sql|yml|yaml|json|xml|plist|nsi|nsh)$/.test(name) && fs.existsSync(path.join(source, name)))
  files.push("scripts/release-version.mjs")
  for (const name of files) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.copyFileSync(path.join(source, name), path.join(root, name))
  }
  git("init", "-b", "main")
  git("config", "user.name", "Release Fixture")
  git("config", "user.email", "release-fixture@example.invalid")
  git("config", "core.autocrlf", "false")
  const commit = () => { git("add", "."); git("commit", "-m", "fixture change") }
  commit()
  git("tag", `v${current}`)
  const run = (...args) => spawnSync(process.execPath, ["scripts/release-version.mjs", ...args], { cwd: root, encoding: "utf8", timeout: 15000 })
  const read = name => fs.readFileSync(path.join(root, name), "utf8")
  const write = (name, content) => fs.writeFileSync(path.join(root, name), content)
  const setSchema = (name, version) => write(name, read(name).replace(/const Version int64 = \d+/, `const Version int64 = ${version}`))
  return { root, git, commit, run, read, write, setSchema }
}

function expectSuccess(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

function expectFailure(result, pattern) {
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, pattern)
}

test("an application-only release passes without any file changes", t => {
  const f = fixture(t)
  expectSuccess(f.run("check"))
  expectSuccess(f.run("release", next))
  assert.equal(f.git("status", "--porcelain").trim(), "")
})

test("complete appended migrations pass once schema.Version follows them", t => {
  const f = fixture(t)
  for (const track of serverTracks) f.write(`${track}/${migrationName(schema + 1, "upgrade")}`, migration)
  f.write(`${desktopTrack}/${migrationName(desktopSchema + 1, "upgrade")}`, migration)
  f.commit()
  expectFailure(f.run("check"), /与最新迁移 .* 不一致/)
  f.setSchema("server/internal/storage/schema/schema.go", schema + 1)
  f.setSchema("desktop/EasySSHDesktop/internal/storage/schema/schema.go", desktopSchema + 1)
  f.commit()
  expectSuccess(f.run("release", next))
})

test("missing dialect migrations are rejected", t => {
  const f = fixture(t)
  f.write(`server/internal/storage/schema/sqlite/${migrationName(schema + 1, "upgrade")}`, migration)
  f.commit()
  expectFailure(f.run("check"), /迁移编号与其他数据库不一致/)
})

test("published SQL cannot be rewritten even after committing the change", t => {
  const f = fixture(t)
  const name = `server/internal/storage/schema/sqlite/${baseline}`
  f.write(name, f.read(name) + "\n-- rewritten after release\n")
  f.commit()
  expectFailure(f.run("check"), /禁止改写/)
  expectFailure(f.run("release", next), /禁止改写/)
})

test("migration gaps and duplicate numbers are rejected", t => {
  const f = fixture(t)
  f.write(`server/internal/storage/schema/sqlite/${migrationName(schema + 2, "gap")}`, migration)
  f.commit()
  expectFailure(f.run("check"), /迁移编号必须连续且不能重复/)
  fs.renameSync(path.join(f.root, `server/internal/storage/schema/sqlite/${migrationName(schema + 2, "gap")}`), path.join(f.root, "server/internal/storage/schema/sqlite/00001_duplicate.sql"))
  f.commit()
  expectFailure(f.run("check"), /迁移编号必须连续且不能重复|必须保留一个初始化基线/)
})

test("downgrades and tags on other commits are rejected", t => {
  const f = fixture(t)
  f.write("change.txt", "next")
  f.commit()
  expectFailure(f.run("release", current), /标签 v1\.0\.0 已存在且不指向当前提交/)
  expectFailure(f.run("release", "0.9.9"), /必须高于已发布版本 1\.0\.0/)
  expectFailure(f.run("release", "v1.0.1"), /版本号必须为 x\.y\.z/)
})

test("the tag pipeline accepts the new tag on HEAD and compares it with the previous release", t => {
  const f = fixture(t)
  f.write("change.txt", "next")
  f.commit()
  f.git("tag", `v${next}`)
  expectSuccess(f.run("release", next))

  const name = `server/internal/storage/schema/sqlite/${baseline}`
  f.write(name, f.read(name) + "\n-- illegal rewrite in newly tagged release\n")
  f.commit()
  f.git("tag", "v1.0.2")
  expectFailure(f.run("release", "1.0.2"), /禁止改写 v1\.0\.1 已发布迁移/)
})

test("published migrations cannot be removed when appending an upgrade", t => {
  const f = fixture(t)
  for (const track of serverTracks) {
    // Replacing the entire baseline would strand deployed databases.
    for (const name of fs.readdirSync(path.join(f.root, track))) fs.unlinkSync(path.join(f.root, track, name))
    f.write(`${track}/${migrationName(schema + 1, "initial")}`, "-- +goose Up\nSELECT 1;\n")
  }
  f.commit()
  expectFailure(f.run("check"), /禁止删除或重命名|初始化基线必须为/)
})

test("upgrades require rollback SQL", t => {
  const f = fixture(t)
  for (const track of serverTracks) f.write(`${track}/${migrationName(schema + 1, "upgrade")}`, "-- +goose Up\nSELECT 1;\n")
  f.commit()
  expectFailure(f.run("check"), /Down 回滚段/)
})

test("stamp writes the release version into every desktop packaging asset", t => {
  const f = fixture(t)
  expectSuccess(f.run("stamp", "2.3.4"))
  const build = "desktop/EasySSHDesktop/build"
  assert.match(f.read(`${build}/config.yml`), /^  version: "2\.3\.4"/m)
  const info = JSON.parse(f.read(`${build}/windows/info.json`))
  assert.equal(info.fixed.file_version, "2.3.4")
  assert.equal(info.info["0000"].ProductVersion, "2.3.4")
  assert.match(f.read(`${build}/windows/nsis/wails_tools.nsh`), /!define INFO_PRODUCTVERSION "2\.3\.4"/)
  for (const name of ["app_manifest.xml", "template.xml"]) assert.match(f.read(`${build}/windows/msix/${name}`), /\bVersion="2\.3\.4\.0"/)
  for (const name of ["Info.plist", "Info.dev.plist"]) assert.equal(f.read(`${build}/darwin/${name}`).match(/<string>2\.3\.4<\/string>/g)?.length, 2)
  assert.match(f.read(`${build}/linux/nfpm/nfpm.yaml`), /^version: "2\.3\.4"/m)
})

test("stamp fails before writing when a version field is missing", t => {
  const f = fixture(t)
  const name = "desktop/EasySSHDesktop/build/windows/info.json"
  const json = JSON.parse(f.read(name))
  delete json.fixed.file_version
  f.write(name, JSON.stringify(json))
  f.commit()
  expectFailure(f.run("stamp", next), /info\.json 的版本字段缺失或重复/)
  assert.equal(f.git("status", "--porcelain").trim(), "")
})
