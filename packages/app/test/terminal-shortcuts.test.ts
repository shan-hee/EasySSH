import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  normalizeShortcut,
  shortcutFromEvent,
} from "../src/components/terminal/terminal-shortcuts"

describe("terminal shortcuts", () => {
  it("records plus, space and macOS modifiers in the same format as stored shortcuts", () => {
    const event = { key: "+", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }
    assert.equal(shortcutFromEvent(event), normalizeShortcut("Ctrl+Shift+Plus"))
    assert.equal(shortcutFromEvent({ ...event, key: " " }), "Ctrl+Shift+Space")
    assert.equal(
      shortcutFromEvent({ ...event, key: "f", ctrlKey: false, metaKey: true }),
      "Shift+Meta+F",
    )
  })

  it("does not capture ordinary typing or incomplete modifier presses", () => {
    const event = { key: "a", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
    assert.equal(shortcutFromEvent(event), null)
    assert.equal(shortcutFromEvent({ ...event, key: "A", shiftKey: true }), null)
    assert.equal(shortcutFromEvent({ ...event, key: "Control", ctrlKey: true }), null)
  })

  it("rejects ambiguous or unmatchable shortcuts and preserves an explicitly cleared binding", () => {
    assert.equal(normalizeShortcut(""), "")
    assert.equal(normalizeShortcut("Shift+Ctrl+k"), "Ctrl+Shift+K")
    for (const value of ["Ctrl+Ctrl+C", "Ctrl+", "Ctrl++", "Shift+A", "Ctrl+Shift", "Ctrl+Unknown"]) {
      assert.equal(normalizeShortcut(value), null)
    }
  })
})
