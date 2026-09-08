import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const origin = process.env.PERF_ORIGIN || 'http://localhost:5200'
const authState = process.env.PERF_AUTH_STATE || '/tmp/easyssh-terminal-perf/auth-state.json'
const output = process.env.PERF_OUTPUT || '/tmp/easyssh-terminal-perf/functional.json'
const backendPid = process.env.PERF_BACKEND_PID
const readBackend = () => {
  if (!backendPid) return null
  const values = fs.readFileSync(`/proc/${backendPid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')
  const status = fs.readFileSync(`/proc/${backendPid}/status`, 'utf8')
  return { at: Date.now(), userTicks: Number(values[11]), systemTicks: Number(values[12]), rssKB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]), threads: Number(status.match(/^Threads:\s+(\d+)/m)?.[1]) }
}
const state = JSON.parse(fs.readFileSync(authState, 'utf8'))
state.origins = state.origins.map(item => ({ ...item, origin }))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } })
await context.addInitScript({ path: path.join(directory, 'terminal-probe.js') })
const page = await context.newPage()
const report = { checks: [], errors: [], requests: [], backend: [], measurements: [] }
page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }))
page.on('response', response => {
  if (response.status() >= 400) report.errors.push({ path: new URL(response.url()).pathname, status: response.status() })
})
page.on('requestfinished', request => {
  const p = new URL(request.url()).pathname
  if (p.startsWith('/api/')) report.requests.push({ path: p.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), durationMs: request.timing().responseEnd })
})
const check = (name, detail) => { report.checks.push({ name, detail, passed: true }); console.log(name) }
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2))
const mainButton = name => page.locator('main').getByRole('button', { name, exact: true })
const monitorMessages = () => page.evaluate(() => window.__terminalPerf.sockets.filter(x => x.path.includes('/monitor')).flatMap(x => x.messages.filter(m => m.type === 'binary')))

try {
  await page.goto(`${origin}/dashboard/terminal`)
  await page.getByText('PVE-Debian 13', { exact: true }).dblclick()
  await page.locator('[data-monitor-density] canvas').first().waitFor({ timeout: 20000 })
  const firstCanvas = await page.locator('[data-monitor-density] canvas').first().elementHandle()
  const initialSamples = (await monitorMessages()).length
  await mainButton('监控').click()
  await page.waitForTimeout(2400)
  assert.ok((await monitorMessages()).length > initialSamples)
  assert.ok(await firstCanvas.evaluate(element => element.isConnected))
  assert.ok(await page.locator('[data-monitor-density]').evaluate(element => !!element.closest('[inert]')))
  await mainButton('监控').click()
  await page.waitForTimeout(400)
  assert.ok(await firstCanvas.evaluate(element => element.isConnected))
  check('监控关闭后持续采集、隐藏内容不可交互、重开复用原 canvas')

  await mainButton('文件管理器').click()
  const sftp = page.locator('aside.terminal-sftp-glass')
  await sftp.getByTitle('根目录', { exact: true }).click()
  await page.waitForTimeout(700)
  assert.ok(await sftp.getByTitle('刷新', { exact: true }).isVisible())
  for (let i = 0; i < 5; i++) {
    const response = page.waitForResponse(res => /\/sftp\/[^/]+\/list/.test(res.url()), { timeout: 15000 })
    await sftp.getByTitle('刷新', { exact: true }).click()
    const res = await response
    assert.equal(res.status(), 200)
  }
  const geometry = await sftp.evaluate(element => {
    const children = [...element.children].filter(child => child.getBoundingClientRect().width > 100)
    return { outer: element.getBoundingClientRect().width, inner: children.map(child => child.getBoundingClientRect().width) }
  })
  assert.ok(geometry.inner.every(width => Math.abs(width - geometry.outer) < 2))
  check('SFTP 根目录读取与 5 次刷新成功，展开后内容宽度匹配', geometry)
  await mainButton('文件管理器').click()

  await mainButton('Docker 管理').click()
  for (const name of ['容器', '镜像', '资源']) {
    await page.getByRole('tab', { name: new RegExp(`^${name}(?:\\s|$)`) }).click()
    await page.waitForTimeout(1800)
    assert.ok(await page.getByRole('tabpanel').isVisible())
  }
  check('Docker 容器、镜像、资源页签可打开（只读）')
  await page.keyboard.press('Escape')

  await mainButton('AI 助手').click()
  await page.locator('aside.terminal-ai-glass').waitFor({ state: 'visible' })
  await page.waitForTimeout(1000)
  const aiGeometry = await page.locator('aside.terminal-ai-glass').evaluate(element => ({ outer: element.getBoundingClientRect().width, inner: element.firstElementChild.getBoundingClientRect().width }))
  assert.ok(Math.abs(aiGeometry.outer - aiGeometry.inner) < 2)
  check('AI 面板加载与布局正常（未发送模型请求）', aiGeometry)
  await mainButton('AI 助手').click()

  // The workspace tab intentionally has no context menu. Add a real session
  // through the user-facing picker before checking session-specific actions.
  await mainButton('新建会话').click()
  await page.getByText('PVE-Debian 13', { exact: true }).last().dblclick()
  await page.waitForFunction(() => window.__terminalPerf.sockets.filter(x => x.path.includes('/terminal') && x.messages.some(m => m.type === 'connected')).length === 2, undefined, { timeout: 25000 })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-session-tab-id]').count(), 2)
  await page.locator('[data-session-tab-id]:not([data-session-tab-id="__terminal-workspace__"])').last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: '复制会话', exact: true }).waitFor({ state: 'visible', timeout: 5000 })
  await page.keyboard.press('Escape')
  check('新建终端和普通会话右键菜单正常')
  const beforeSwitch = await page.evaluate(() => window.__terminalPerf.sockets.length)
  for (let i = 0; i < 10; i++) {
    const start = await page.evaluate(() => performance.now())
    await page.locator('[data-session-tab-id]').nth(i % 2).click()
    await page.waitForTimeout(300)
    const end = await page.evaluate(() => performance.now())
    report.measurements.push({ name: 'tab-switch', start, end })
  }
  const socketState = await page.evaluate(() => ({ sockets: window.__terminalPerf.sockets.length, monitors: window.__terminalPerf.sockets.filter(x => x.path.includes('/monitor') && !x.close).length, terminals: window.__terminalPerf.sockets.filter(x => x.path.includes('/terminal') && !x.close).length }))
  assert.equal(socketState.sockets, beforeSwitch)
  assert.equal(socketState.monitors, 1)
  assert.equal(socketState.terminals, 2)
  check('两个终端页签切换 10 次，复用一个监控连接且不重复建连', socketState)

  const sampleStart = (await monitorMessages()).length
  report.backend.push(readBackend())
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(5000)
    report.backend.push(readBackend())
    console.log(`持续采集 ${5 * (i + 1)} 秒`)
  }
  const samples = (await monitorMessages()).slice(sampleStart)
  assert.ok(samples.length >= 12)
  check('双页签 30 秒持续采集', { samples: samples.length })
  report.monitorSamples = samples
  await page.locator('[data-session-tab-id]').last().hover()
  await page.locator('[data-session-tab-id]').last().getByRole('button', { name: '关闭标签页', exact: true }).click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-session-tab-id]').count(), 1)
  check('关闭测试页签后保留剩余会话')

  await page.setViewportSize({ width: 1100, height: 720 })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-monitor-density]').getAttribute('data-monitor-density'), 'compact')
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-monitor-density]').getAttribute('data-monitor-density'), 'mini')
  check('监控 compact / mini 响应式布局正确')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await mainButton('监控').click()
  await page.locator('[data-monitor-density]').waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await mainButton('监控').click()
  await mainButton('文件管理器').click()
  await page.waitForTimeout(350)
  assert.ok(Math.abs((await sftp.boundingBox()).width - 390) < 40)
  await page.keyboard.press('Control+e')
  check('390px 移动布局：监控与文件面板可开关，无页面横向溢出')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(500)
  await mainButton('文件管理器').click()
  assert.equal(await sftp.evaluate(element => getComputedStyle(element).transitionProperty), 'none')
  await mainButton('文件管理器').click()
  const monitor = page.locator('[data-monitor-density]')
  assert.equal(await monitor.evaluate(element => getComputedStyle(element.parentElement).transitionProperty), 'none')
  check('减少动态效果偏好生效')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  report.data = await page.evaluate(() => window.__terminalPerf)
  const main = page.locator('main')
  await page.screenshot({ path: output.replace(/\.json$/, '.png'), clip: await main.boundingBox() })
  report.completed = true
} catch (error) {
  report.fatal = { message: error.message, stack: error.stack }
  report.failureText = (await page.locator('main').innerText()).slice(0, 2500)
  console.error(error.message)
  process.exitCode = 1
} finally {
  save()
  await context.storageState({ path: authState })
  fs.chmodSync(authState, 0o600)
  await browser.close()
}
