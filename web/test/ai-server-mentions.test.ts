import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { hasServerMention, matchServerMentionTrigger } from "../src/lib/ai-agent/server-mentions"

describe("server mention trigger", () => {
  it("opens at the start and after text, whitespace or punctuation", () => {
    for (const prefix of ["", "检查", "inspect", "检查 ", "检查\n", "检查\t", "检查，", "检查：", "🔎"]) {
      const text = `${prefix}@prod`
      assert.deepEqual(matchServerMentionTrigger(text, "@", text.length), {
        query: "prod", offset: prefix.length, endOffset: text.length,
      })
    }
  })

  it("uses the current caret without consuming the rest of the sentence", () => {
    const text = "请检查@prod 的磁盘"
    assert.deepEqual(matchServerMentionTrigger(text, "@", "请检查@prod".length), {
      query: "prod", offset: 3, endOffset: 8,
    })
    assert.equal(matchServerMentionTrigger(text, "@", 3), null)
  })

  it("closes after insertion whitespace and can open for a second reference", () => {
    for (const suffix of [" ", "\n", "\t"]) {
      const text = `检查@prod${suffix}`
      assert.equal(matchServerMentionTrigger(text, "@", text.length), null)
    }
    const text = "比较@prod 和@"
    assert.deepEqual(matchServerMentionTrigger(text, "@", text.length), {
      query: "", offset: text.length - 1, endOffset: text.length,
    })
  })
})

describe("server mention context", () => {
  it("recognizes references followed by whitespace, punctuation or the end of text", () => {
    for (const suffix of ["", " 检查磁盘", "\n检查磁盘", "\t检查磁盘", "，检查磁盘", "]", "）"]) {
      assert.equal(hasServerMention(`请对@prod${suffix}`, "prod"), true)
    }
  })

  it("matches display names literally, including spaces and regex characters", () => {
    assert.equal(hasServerMention("请检查@prod [EU].1+ 负载", "prod [EU].1+"), true)
    assert.equal(hasServerMention("请检查@prodX1 负载", "prod.1"), false)
  })

  it("does not mistake a longer server name for the referenced server", () => {
    assert.equal(hasServerMention("请检查@production ", "prod"), false)
    assert.equal(hasServerMention("请检查@prod-2 ", "prod"), false)
    assert.equal(hasServerMention("比较@prod-2 和@prod ", "prod"), true)
    assert.equal(hasServerMention("请检查prod", "prod"), false)
  })
})
