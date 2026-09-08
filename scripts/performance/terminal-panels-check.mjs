import fs from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const origin = process.env.PERF_ORIGIN || 'http://localhost:5198'
const auth = process.env.PERF_AUTH_STATE || '/tmp/easyssh-terminal-round2/auth-state.json'
const output = process.env.PERF_OUTPUT || '/tmp/easyssh-terminal-round2/panels-before.json'
const verify = process.env.PERF_VERIFY === '1'
const state = JSON.parse(fs.readFileSync(auth, 'utf8'))
// 独立测试会话从默认面板状态开始，避免上一轮失败留下的展开状态污染比较。
state.origins = state.origins.map(item => ({ ...item, origin, localStorage: item.localStorage.filter(entry => entry.name !== 'tab-ui-storage') }))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } })
const report = { checks: [], diagnostics: [], errors: [] }
const check = (name, details) => { report.checks.push({ name, details, passed: true }); console.log(name) }
await context.addInitScript(() => {
  window.__panels = { styles: 0, rects: 0, resizes: [], sizes: [] }
  const style = window.getComputedStyle
  window.getComputedStyle = function (...args) { window.__panels.styles++; return Reflect.apply(style, this, args) }
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (...args) { window.__panels.rects++; return Reflect.apply(rect, this, args) }
  const Socket = window.WebSocket
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args)
      if (!new URL(args[0], location.href).pathname.includes('/terminal')) return
      let buffer = ''
      const decoder = new TextDecoder()
      this.addEventListener('message', event => {
        if (!(event.data instanceof ArrayBuffer)) return
        // Only the explicit stty size marker is retained. No shell output is reported.
        buffer = (buffer + decoder.decode(event.data, { stream: true })).slice(-8192)
        const match = buffer.match(/\x1e\s*(\d+)\s+(\d+)\s*\x1f/)
        if (match) { window.__panels.sizes.push({ rows: +match[1], cols: +match[2] }); buffer = '' }
      })
      const send = this.send
      this.send = function (payload) {
        if (typeof payload === 'string') {
          try { const value = JSON.parse(payload); if (value.type === 'resize') window.__panels.resizes.push({ ...value.data, at: performance.now() }) } catch {}
        }
        return send.call(this, payload)
      }
    }
  }
})
const page = await context.newPage()
page.on('pageerror', e => report.errors.push({ type: 'pageerror', message: e.message }))
page.on('response', r => { if (r.status() >= 400) report.errors.push({ path: new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), status: r.status() }) })
const button = name => page.locator('main').getByRole('button', { name, exact: true })
const closeSettings = () => page.locator('[data-slot="dialog-close"]').click()
const settle = () => page.waitForTimeout(500)
const resetCounters = () => page.evaluate(() => { window.__panels.styles = 0; window.__panels.rects = 0; window.__panels.resizes = [] })
const counters = () => page.evaluate(() => ({ styles: window.__panels.styles, rects: window.__panels.rects, resizes: window.__panels.resizes }))
async function remoteSize() {
  const count = await page.evaluate(() => window.__panels.sizes.length)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type("printf '\\036'; stty size; printf '\\037'", { delay: 0 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(count => window.__panels.sizes.length > count, count, { timeout: 10000 })
  return page.evaluate(() => window.__panels.sizes.at(-1))
}
try {
  await page.goto(`${origin}/dashboard/terminal`)
  await page.getByText('PVE-Debian 13', { exact: true }).dblclick()
  await page.locator('[data-monitor-density] canvas').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(2400)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  for (let round = 0; round < 3; round++) {
    await resetCounters()
    await button('终端设置').click(); await settle()
    report.diagnostics.push({ name: 'settings-open', round, ...await counters() })
    await closeSettings(); await settle()
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await button('终端设置').click(); await settle()
  const focusedTitle = await page.evaluate(() => document.activeElement?.tagName === 'H2')
  if (verify) assert.ok(focusedTitle)
  const dialog = page.getByRole('dialog')
  for (let tab = 0; tab < 5; tab++) {
    await dialog.locator('[data-slot="tabs-trigger"]').nth(tab).click()
    assert.equal(await dialog.locator('[data-slot="tabs-content"][data-state="active"]').count(), 1)
    assert.ok(await dialog.locator('[data-slot="tabs-content"][data-state="active"]').innerText())
  }
  await closeSettings(); await settle()
  check('设置五个分类与焦点检查', { focusedTitle })

  await button('AI 助手').click(); await page.locator('.aui-thread-root').waitFor(); await page.waitForTimeout(700)
  const thread = await page.locator('.aui-thread-root').elementHandle()
  for (let i = 0; i < 3; i++) { await button('AI 助手').click(); await settle(); await button('AI 助手').click(); await settle() }
  const reused = await thread.evaluate(e => e.isConnected)
  report.diagnostics.push({ name: 'ai-thread-reused', reused })
  if (verify) assert.ok(reused)
  await button('AI 助手').click(); await settle()
  check('AI 面板开关与消息区实例检查', { reused })

  if (process.env.PERF_DIAGNOSTICS_ONLY !== '1') {
  if (verify) {
    for (const exitName of ['保存设置', '取消']) {
      await button('终端设置').click(); await settle()
      await dialog.locator('[data-slot="tabs-trigger"]').nth(1).click()
      await dialog.getByRole('button', { name: exitName, exact: true }).click(); await settle()
      await button('终端设置').click(); await settle()
      assert.equal(await dialog.locator('[data-slot="tabs-trigger"]').first().getAttribute('data-state'), 'active')
      await closeSettings(); await settle()
    }
    check('设置保存或取消后，再次打开回到终端分类')
  }
  const initial = await remoteSize()
  await resetCounters()
  await button('监控').click(); await settle()
  const wide = await remoteSize()
  assert.ok(wide.cols > initial.cols)
  for (let i = 0; i < 6; i++) { await button('监控').click(); await page.waitForTimeout(25) }
  await settle()
  assert.deepEqual(await remoteSize(), wide)
  await button('监控').click(); await settle()
  assert.deepEqual(await remoteSize(), initial)
  report.diagnostics.push({ name: 'monitor-resize', initial, wide, ...await counters() })
  check('监控快速反向开关后，远端 PTY 尺寸恢复正确')

  for (const name of ['文件管理器', 'AI 助手']) {
    await button(name).click(); await settle()
    const narrow = await remoteSize()
    assert.ok(narrow.cols < initial.cols)
    const separator = page.locator(name === '文件管理器' ? 'aside.terminal-sftp-glass .cursor-col-resize' : 'aside.terminal-ai-glass [role="separator"]')
    const box = await separator.boundingBox()
    assert.ok(box)
    await page.mouse.move(box.x + box.width / 2, box.y + 80)
    await page.mouse.down(); await page.mouse.move(box.x - 65, box.y + 80, { steps: 8 }); await page.mouse.up(); await settle()
    const narrower = await remoteSize()
    assert.ok(narrower.cols < narrow.cols)
    const moved = await separator.boundingBox()
    await page.mouse.move(moved.x + moved.width / 2, moved.y + 80)
    await page.mouse.down(); await page.mouse.move(moved.x + moved.width / 2 + 65 + box.width / 2, moved.y + 80, { steps: 8 }); await page.mouse.up(); await settle()
    await button(name).click(); await settle()
    assert.deepEqual(await remoteSize(), initial)
    check(`${name}展开、拖动和关闭后，远端 PTY 尺寸正确`, { narrow, narrower })
  }

  await button('终端设置').click(); await settle()
  const font = page.locator('#fontSize [role="slider"]')
  await font.focus(); await page.keyboard.press('ArrowRight'); await settle(); await closeSettings(); await settle()
  const biggerFont = await remoteSize()
  report.diagnostics.push({ name: 'font-resize', initial, biggerFont })
  if (verify) assert.ok(biggerFont.cols < initial.cols && biggerFont.rows < initial.rows)
  await button('终端设置').click(); await settle(); await font.focus(); await page.keyboard.press('ArrowLeft'); await settle(); await closeSettings(); await settle()
  if (verify) assert.deepEqual(await remoteSize(), initial)
  check('字体修改与恢复同步远端 PTY')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await button('监控').click(); await settle(); assert.ok((await remoteSize()).cols > initial.cols)
  await button('监控').click(); await settle(); assert.deepEqual(await remoteSize(), initial)
  check('减少动态效果模式无需 transitionend 也可适配')
  }
  assert.deepEqual(report.errors, [])
  report.completed = true
} catch (e) {
  report.fatal = { message: e.message, stack: e.stack }
  process.exitCode = 1
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  await context.storageState({ path: auth }); fs.chmodSync(auth, 0o600)
  await browser.close()
}
