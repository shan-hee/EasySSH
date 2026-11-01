import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const schemas = {
  server: { directory: "server/internal/storage/schema", drivers: ["sqlite", "postgres", "mysql"] },
  desktop: { directory: "desktop/EasySSHDesktop/internal/storage/schema", drivers: ["sqlite"] },
}

try {
  const [host, description, ...extra] = process.argv.slice(2)
  if (!Object.hasOwn(schemas, host ?? "") || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(description ?? "") || description === "initial" || extra.length) {
    throw new Error("用法：node scripts/new-migration.mjs <server|desktop> <lower_snake_case>；initial 为保留名称")
  }
  const { directory, drivers } = schemas[host]
  let expected
  for (const driver of drivers) {
    const names = fs.readdirSync(path.join(root, directory, driver)).filter(name => name.endsWith(".sql")).sort()
    if (names[0] !== "00001_initial.sql") throw new Error(`${driver} 缺少 00001_initial.sql`)
    for (const [index, name] of names.entries()) {
      const match = /^(\d{5})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.sql$/.exec(name)
      if (!match || Number(match[1]) !== index + 1 || (index > 0 && match[2] === "initial")) {
        throw new Error(`${driver} 的迁移文件名或编号不连续：${name}`)
      }
      if (match[2] === description) throw new Error(`迁移描述已存在：${description}`)
    }
    if (expected && JSON.stringify(expected) !== JSON.stringify(names)) throw new Error("各数据库的迁移编号及名称必须一致")
    expected = names
  }
  const next = expected.length + 1
  if (next > 99999) throw new Error("迁移编号超出五位编号范围")
  const schemaFile = path.join(root, directory, "schema.go")
  const original = fs.readFileSync(schemaFile, "utf8")
  const versionPattern = /^const Version int64 = (\d+)$/m
  if (Number(original.match(versionPattern)?.[1]) !== next - 1) throw new Error("schema.Version 与现有迁移不一致，请先处理未完成的迁移")
  const filename = `${String(next).padStart(5, "0")}_${description}.sql`
  const created = []
  try {
    for (const driver of drivers) {
      const name = path.join(root, directory, driver, filename)
      const header = driver === "mysql"
        ? "-- +goose NO TRANSACTION\n-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.\n-- Protect data changes with a transaction and an error handler that rolls back.\n"
        : "-- Goose wraps each direction and its version record in a transaction.\n"
      fs.writeFileSync(name, `${header}\n-- +goose Up\n-- TODO: implement the forward migration.\n\n-- +goose Down\n-- TODO: implement rollback and document any data loss.\n`, { flag: "wx" })
      created.push(name)
    }
    fs.writeFileSync(schemaFile, original.replace(versionPattern, `const Version int64 = ${next}`))
  } catch (error) {
    for (const name of created) fs.unlinkSync(name)
    fs.writeFileSync(schemaFile, original)
    throw error
  }
  for (const name of created) console.log(path.relative(root, name))
  console.log(`${host} schema.Version 已更新为 ${next}。请填写所有 Up / Down SQL，并更新结构校验及文档；空模板不能通过发布检查。没有连接数据库、执行迁移、构建或测试。`)
} catch (error) {
  console.error(`创建迁移失败：${error.message}`)
  process.exitCode = 1
}
