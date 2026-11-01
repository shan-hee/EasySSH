import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"

const source = fileURLToPath(new URL("../", import.meta.url))
const current = fs.readFileSync(path.join(source, "VERSION"), "utf8").trim()
const next = current.replace(/\d+$/, patch => String(Number(patch) + 1))
const schema = Number(fs.readFileSync(path.join(source, "server/internal/storage/schema/schema.go"), "utf8").match(/const Version int64 = (\d+)/)[1])
const migrationName = (number, suffix) => `${String(number).padStart(5, "0")}_${suffix}.sql`
const tracks = ["server/internal/storage/schema/sqlite", "server/internal/storage/schema/postgres", "server/internal/storage/schema/mysql", "desktop/EasySSHDesktop/internal/storage/schema/sqlite"]
const migration = "-- +goose Up\nSELECT 1;\n-- +goose Down\nSELECT 1;\n"
const baseline = "00001_initial.sql"
const desktopSchema = Number(fs.readFileSync(path.join(source, "desktop/EasySSHDesktop/internal/storage/schema/schema.go"), "utf8").match(/const Version int64 = (\d+)/)[1])

function fixture(t) {
  const prefix = path.join(os.tmpdir(), "easyssh-release-check-")
  const root = fs.mkdtempSync(prefix)
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(prefix))) throw new Error("unexpected fixture path")
    fs.rmSync(root, { recursive: true, force: true })
  })
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "desktop/EasySSHDesktop/build", "server/internal/storage/schema", "desktop/EasySSHDesktop/internal/storage/schema"], { cwd: source, encoding: "utf8" })
    .trim().split("\n").filter(name => /\.(?:go|sql|yml|yaml|json|xml|plist|nsi|nsh)$/.test(name) && fs.existsSync(path.join(source, name)))
  files.push("VERSION", "README.md", "web/package.json", "desktop/EasySSHDesktop/frontend/package.json", "desktop/EasySSHDesktop/internal/app/desktopversion.go", "scripts/release-version.mjs")
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
  return { root, git, commit, run, read, write }
}

function expectFailure(result, pattern) {
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, pattern)
}

test("an application-only release updates all versions without changing the database version or Git tags", t => {
  const f = fixture(t)
  const result = f.run("--prepare", next)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(f.read("VERSION").trim(), next)
  assert.equal(JSON.parse(f.read("web/package.json")).version, next)
  assert.equal(JSON.parse(f.read("desktop/EasySSHDesktop/frontend/package.json")).version, next)
  assert.match(f.read("server/internal/storage/schema/schema.go"), new RegExp(`const Version int64 = ${schema}\\b`))
  assert.equal(f.git("tag", "--list", `v${next}`).trim(), "")
  assert.equal(f.git("diff", "--cached", "--name-only").trim(), "")
  assert.equal(f.run("--release", next).status, 0)
})

test("complete appended migrations synchronize each host version independently", t => {
  const f = fixture(t)
  for (const track of tracks) {
    const currentSchema = track.startsWith("desktop/") ? desktopSchema : schema
    f.write(`${track}/${migrationName(currentSchema + 1, "upgrade")}`, migration)
  }
  f.commit()
  const result = f.run("--prepare", next)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(f.read("server/internal/storage/schema/schema.go"), new RegExp(`const Version int64 = ${schema + 1}\\b`))
  assert.equal(f.run("--release", next).status, 0)
})

test("missing dialect migrations stop the release before any version writes", t => {
  const f = fixture(t)
  f.write(`server/internal/storage/schema/sqlite/${migrationName(schema + 1, "upgrade")}`, migration)
  f.commit()
  expectFailure(f.run("--prepare", next), /迁移编号与其他数据库不一致/)
  assert.equal(f.read("VERSION").trim(), current)
  assert.equal(f.git("status", "--porcelain").trim(), "")
})

test("published SQL cannot be rewritten even after committing the change", t => {
  const f = fixture(t)
  const name = `server/internal/storage/schema/sqlite/${baseline}`
  f.write(name, f.read(name) + "\n-- rewritten after release\n")
  f.commit()
  expectFailure(f.run("--prepare", next), /禁止改写/)
  assert.equal(f.git("status", "--porcelain").trim(), "")
})

test("migration gaps and duplicate numbers are rejected", t => {
  const f = fixture(t)
  f.write(`server/internal/storage/schema/sqlite/${migrationName(schema + 2, "gap")}`, migration)
  f.commit()
  expectFailure(f.run("--prepare", next), /迁移编号必须连续且不能重复/)
  fs.renameSync(path.join(f.root, `server/internal/storage/schema/sqlite/${migrationName(schema + 2, "gap")}`), path.join(f.root, "server/internal/storage/schema/sqlite/00001_duplicate.sql"))
  f.commit()
  expectFailure(f.run("--prepare", next), /迁移编号必须连续且不能重复|必须保留一个初始化基线/)
})

test("dirty working trees, downgrade versions and existing tags are rejected", t => {
  const f = fixture(t)
  f.write("unfinished.txt", "uncommitted code")
  expectFailure(f.run("--prepare", next), /工作区及暂存区必须干净/)
  f.commit()
  expectFailure(f.run("--prepare", current), /新版本必须高于/)
  f.git("tag", `v${next}`)
  expectFailure(f.run("--prepare", next), /新版本必须高于|标签.*已存在/)
})

test("version field drift is detected before updating VERSION", t => {
  const f = fixture(t)
  const name = "desktop/EasySSHDesktop/build/windows/info.json"
  const json = JSON.parse(f.read(name))
  json.fixed.file_version = "0.0.1"
  f.write(name, JSON.stringify(json))
  f.commit()
  expectFailure(f.run("--prepare", next), /版本字段缺失、重复或与 VERSION 不一致/)
  assert.equal(f.read("VERSION").trim(), current)
  assert.equal(f.git("status", "--porcelain").trim(), "")
})

test("the release gate compares the new tag with its previous release", t => {
  const f = fixture(t)
  assert.equal(f.run("--prepare", next).status, 0)
  const name = `server/internal/storage/schema/sqlite/${baseline}`
  f.write(name, f.read(name) + "\n-- illegal rewrite in newly tagged release\n")
  f.commit()
  f.git("tag", `v${next}`)
  expectFailure(f.run("--release", next), /禁止改写/)
})

test("published migrations cannot be removed when appending an upgrade", t => {
  const f = fixture(t)
  for (const track of tracks.slice(0, 3)) {
    fs.unlinkSync(path.join(f.root, `${track}/${baseline}`))
    // Replacing the entire baseline would strand deployed databases.
    for (const name of fs.readdirSync(path.join(f.root, track))) fs.unlinkSync(path.join(f.root, track, name))
    f.write(`${track}/${migrationName(schema + 1, "initial")}`, "-- +goose Up\nSELECT 1;\n")
  }
  f.commit()
  expectFailure(f.run("--prepare", next), /禁止删除或重命名|初始化基线必须为/)
  assert.equal(f.read("VERSION").trim(), current)
})

test("upgrades require rollback SQL", t => {
  const f = fixture(t)
  for (const track of tracks.slice(0, 3)) f.write(`${track}/${migrationName(schema + 1, "upgrade")}`, "-- +goose Up\nSELECT 1;\n")
  f.commit()
  expectFailure(f.run("--prepare", next), /Down 回滚段/)
})
