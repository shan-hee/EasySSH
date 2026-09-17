import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DEFAULT_TERMINAL_SETTINGS,
  createTerminalSettingsExportPayload,
  isTerminalBackgroundImage,
  normalizeTerminalSettings,
  parseTerminalSettingsImport,
  resolveTerminalInactiveMinutes,
  serializeTerminalSettingsExport,
} from "../src/components/terminal/terminal-settings"

describe("terminal settings", () => {
  it("preserves the color theme when switching and exporting surface materials", () => {
    for (const theme of ["default", "light", "dark", "solarized", "dracula"] as const) {
      const glass = normalizeTerminalSettings({
        ...DEFAULT_TERMINAL_SETTINGS,
        theme,
        material: "glass",
        backgroundImage: "https://example.com/wallpaper.png",
        backgroundImageOpacity: 45,
      })
      assert.equal(glass.theme, theme)
      assert.equal(glass.material, "glass")
      assert.deepEqual(parseTerminalSettingsImport(serializeTerminalSettingsExport(glass)), glass)

      const standard = normalizeTerminalSettings({ ...glass, material: "solid" })
      assert.deepEqual(standard, { ...glass, material: "solid" })
      assert.deepEqual(parseTerminalSettingsImport(serializeTerminalSettingsExport(standard)), standard)
    }
  })

  it("round-trips customized preferences without losing disabled shortcuts or reminders", () => {
    const settings = {
      ...DEFAULT_TERMINAL_SETTINGS,
      fontSize: 24,
      lineHeight: 1.4,
      inactiveMinutes: 0,
      autoReconnect: false,
      copyShortcut: "",
      backgroundImage: "https://example.com/wallpaper.png",
      backgroundImageOpacity: 35,
    }
    for (const fontWeight of ["100", "200", "300", "400", "500", "600", "700", "800", "900"] as const) {
      const customized = { ...settings, fontWeight }
      assert.deepEqual(parseTerminalSettingsImport(serializeTerminalSettingsExport(customized)), customized)
    }
  })

  it("rejects incomplete, obsolete and invalid imports rather than silently changing them", () => {
    const payload = createTerminalSettingsExportPayload(DEFAULT_TERMINAL_SETTINGS)
    const incomplete: Partial<typeof payload.settings> = { ...payload.settings }
    delete incomplete.fontSize
    const cases = [
      { ...payload, version: payload.version - 1 },
      { ...payload, settings: incomplete },
      { ...payload, settings: { ...payload.settings, fontSize: 500 } },
      { ...payload, settings: { ...payload.settings, fontWeight: "950" } },
      { ...payload, settings: { ...payload.settings, fontWeight: 500 } },
      { ...payload, settings: { ...payload.settings, confirmBeforeClose: true } },
      { ...payload, settings: { ...payload.settings, pasteShortcut: payload.settings.copyShortcut } },
    ]
    for (const value of cases) {
      assert.throws(() => parseTerminalSettingsImport(JSON.stringify(value)))
    }
    assert.throws(() => parseTerminalSettingsImport("{invalid"))
  })

  it("normalizes stored values and removes retired settings", () => {
    const settings = normalizeTerminalSettings({
      fontSize: 100,
      lineHeight: 9,
      scrollback: 1_000_000,
      backgroundImageOpacity: 37,
      fontFamily: "missing-font",
      fontWeight: "invalid",
      monitorInterval: 30,
      confirmBeforeClose: true,
      maxTabs: 10,
    })
    assert.equal(settings.fontSize, 40)
    assert.equal(settings.lineHeight, DEFAULT_TERMINAL_SETTINGS.lineHeight)
    assert.equal(settings.scrollback, DEFAULT_TERMINAL_SETTINGS.scrollback)
    assert.equal(settings.backgroundImageOpacity, 35)
    assert.equal(settings.fontFamily, DEFAULT_TERMINAL_SETTINGS.fontFamily)
    assert.equal(settings.fontWeight, DEFAULT_TERMINAL_SETTINGS.fontWeight)
    assert.ok(!("monitorInterval" in settings))
    assert.ok(!("confirmBeforeClose" in settings))
    assert.ok(!("maxTabs" in settings))
  })

  it("normalizes shortcut spelling and prevents two actions sharing one shortcut", () => {
    const settings = normalizeTerminalSettings({
      copyShortcut: "Shift+Ctrl+c",
      pasteShortcut: "Ctrl+Shift+C",
      clearShortcut: "",
    })
    assert.equal(settings.copyShortcut, "Ctrl+Shift+C")
    assert.equal(settings.pasteShortcut, "")
    assert.equal(settings.clearShortcut, "")
  })

  it("accepts supported background sources and rejects credentials or executable URLs", () => {
    for (const source of ["", "https://example.com/bg.png", "data:image/png;base64,aGVsbG8="]) {
      assert.equal(isTerminalBackgroundImage(source), true)
    }
    for (const source of [
      "https://user:secret@example.com/bg.png",
      "javascript:alert(1)",
      "file:///wallpaper.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
    ]) {
      assert.equal(isTerminalBackgroundImage(source), false)
    }
  })

  it("respects the reminder policy limit while preserving the disabled option", () => {
    assert.equal(resolveTerminalInactiveMinutes(120, 60), 60)
    assert.equal(resolveTerminalInactiveMinutes(15, 60), 15)
    assert.equal(resolveTerminalInactiveMinutes(0, 60), 0)
    assert.equal(resolveTerminalInactiveMinutes(120), 120)
  })
})
