import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { matchServerMentionTrigger, mergeServerReferences, readServerReferences } from "../src/lib/ai-agent/server-mentions"

const server = (server_id: string, name = "prod") => ({ server_id, name, host: "host.example", port: 22, username: "root" })

describe("server reference trigger", () => {
  it("opens only at the start or after whitespace", () => {
    for (const prefix of ["", "检查 ", "inspect ", "检查\n", "检查\t"]) {
      const text = `${prefix}@prod`
      assert.deepEqual(matchServerMentionTrigger(text, "@", text.length), {
        query: "prod", offset: prefix.length, endOffset: text.length,
      })
    }
  })

  it("leaves email, SSH targets and embedded @ characters as plain text", () => {
    for (const text of ["xiongwg2022@gmail.com的dedde", "ssh root@prod", "git@github.com:repo", "检查@prod", "@@prod", "@prod "]) {
      assert.equal(matchServerMentionTrigger(text, "@", text.length), null)
    }
  })

  it("uses the caret position and allows another explicit trigger", () => {
    const text = "请检查 @prod 的磁盘"
    assert.deepEqual(matchServerMentionTrigger(text, "@", 9), { query: "prod", offset: 4, endOffset: 9 })
    assert.equal(matchServerMentionTrigger(text, "@", 4), null)
    assert.deepEqual(matchServerMentionTrigger("比较 @", "@", 4), { query: "", offset: 3, endOffset: 4 })
  })
})

describe("structured server references", () => {
  it("keeps different IDs even when display names are identical", () => {
    assert.deepEqual(mergeServerReferences([server("a")], [server("b")]), [server("a"), server("b")])
  })

  it("deduplicates by ID and keeps the latest snapshot after a rename", () => {
    assert.deepEqual(mergeServerReferences([server("a")], [server("a", "renamed [EU].1+")]), [server("a", "renamed [EU].1+")])
  })

  it("restores references from message metadata, never from visible @ text", () => {
    const refs = [server("a", "prod [EU].1+")]
    assert.deepEqual(readServerReferences(JSON.parse(JSON.stringify(refs))), refs)
    assert.deepEqual(readServerReferences("@prod"), [])
    assert.deepEqual(readServerReferences([{ name: "prod" }]), [])
  })
})

import { parseServerReferenceText, serverReferenceFormatter, serializeServerReferenceText } from "../src/lib/ai-agent/server-mentions"

describe("inline reference round trip", () => {
  it("preserves punctuation in names, repeated IDs, emoji and multiline offsets", () => {
    const a = server("a", "prod [EU].1+ 100%")
    const b = server("b", a.name)
    const token = (ref: typeof a) => serverReferenceFormatter.serialize({ id: ref.server_id, type: "server", label: ref.name })
    const draft = `😀 重启 ${token(a)}\n查看 ${token(b)}，再检查 ${token(a)}`
    const parsed = parseServerReferenceText(draft, [a, b])
    assert.equal(parsed.content, `😀 重启 @${a.name}\n查看 @${b.name}，再检查 @${a.name}`)
    assert.deepEqual(parsed.references.map((ref) => ref.server_id), ["a", "b", "a"])
    for (const ref of parsed.references) assert.equal(parsed.content.slice(ref.offset!, ref.offset! + ref.label!.length + 1), `@${ref.label}`)
    assert.equal(serializeServerReferenceText(parsed.content, parsed.references), draft)
  })

  it("does not erase ordinary directives or reuse deleted references", () => {
    const input = "example :tool[weather]{name=tool-id}, root@host and @prod"
    assert.equal(parseServerReferenceText(input, [server("a")]).content, input)
    assert.deepEqual(parseServerReferenceText(input, [server("a")]).references, [])
    assert.deepEqual(serverReferenceFormatter.parse(input), [{ kind: "text", text: input }])
  })

  it("keeps identity when a copied reference has no cached snapshot", () => {
    const token = serverReferenceFormatter.serialize({ id: "deleted-id", type: "server", label: "missing" })
    const parsed = parseServerReferenceText(token, [])
    assert.equal(parsed.references[0]?.server_id, "deleted-id")
    assert.equal(parsed.content, "@missing")
  })
})
