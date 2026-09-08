import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const origin = process.env.PERF_ORIGIN || 'http://localhost:5198'
const output = process.env.PERF_OUTPUT || '/tmp/easyssh-terminal-perf/baseline.json'
const authState = process.env.PERF_AUTH_STATE || '/tmp/easyssh-terminal-perf/auth-state.json'
const rounds = Number(process.env.PERF_ROUNDS || 5)
const menuRounds = Number(process.env.PERF_MENU_ROUNDS || 6)
const caches = (process.env.PERF_CACHES || 'cold,warm').split(',')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const state = JSON.parse(fs.readFileSync(authState, 'utf8'))
// Ports differ for the two immutable release builds. Auth cookies remain local.
// 独立测试会话从默认面板状态开始，避免上一轮失败留下的展开状态污染比较。
state.origins = state.origins.map(item => ({ ...item, origin, localStorage: item.localStorage.filter(entry => entry.name !== 'tab-ui-storage') }))
const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
await context.addInitScript({ path: path.join(directory, 'terminal-probe.js') })
const report = { version: 1, createdAt: new Date().toISOString(), origin, browser: browser.version(), viewport: { width: 1440, height: 900 }, connections: [], actions: [], errors: [], requests: [], checks: [] }
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2))
function quantile(xs, q) {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null
}
function summarize(data, start, end) {
  const intervals = data.frames.slice(1).map((t, i) => ({ t, dt: t - data.frames[i] })).filter(x => x.t >= start && x.t <= end).map(x => x.dt)
  const tasks = data.longTasks.filter(x => x.start < end && x.start + x.duration > start)
  const events = data.events.filter(x => x.start >= start && x.start <= end && x.interactionId)
  return { durationMs: end - start, frames: intervals.length, frameP50Ms: quantile(intervals, .5), frameP95Ms: quantile(intervals, .95), frameMaxMs: Math.max(0, ...intervals), framesOver25Ms: intervals.filter(x => x > 25).length, framesOver50Ms: intervals.filter(x => x > 50).length, longTasks: tasks.length, longTaskTotalMs: tasks.reduce((s, x) => s + x.duration, 0), maxEventMs: Math.max(0, ...events.map(x => x.duration)), events }
}
async function collect(page) {
  return page.evaluate(() => ({ ...window.__terminalPerf, measures: performance.getEntriesByType('measure').map(x => ({ name: x.name, start: x.startTime, duration: x.duration })), resources: performance.getEntriesByType('resource').filter(x => x.initiatorType === 'script' || x.name.includes('MonitorPanel')).map(x => ({ path: new URL(x.name).pathname, start: x.startTime, duration: x.duration, bytes: x.transferSize })), memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null }))
}
function observePage(page, run) {
  page.on('crash', () => report.errors.push({ run, type: 'renderer-crash' }))
  page.on('pageerror', error => report.errors.push({ run, type: 'pageerror', message: error.message }))
  page.on('requestfinished', request => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    const timing = request.timing()
    report.requests.push({ run, method: request.method(), path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), start: timing.startTime, durationMs: timing.responseEnd, ttfbMs: timing.responseStart })
  })
  page.on('requestfailed', request => report.errors.push({ run, type: 'requestfailed', path: new URL(request.url()).pathname, message: request.failure()?.errorText }))
  page.on('response', response => { if (response.status() >= 400) report.errors.push({ run, type: 'http', path: new URL(response.url()).pathname, status: response.status() }) })
}
async function connect(page, label, clearCache) {
  observePage(page, label)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  if (clearCache) await cdp.send('Network.clearBrowserCache')
  await page.goto(`${origin}/dashboard/terminal`)
  await page.getByText('PVE-Debian 13', { exact: true }).waitFor({ timeout: 20000 })
  const click = await page.evaluate(() => performance.now())
  await page.getByText('PVE-Debian 13', { exact: true }).dblclick()
  await page.locator('[data-monitor-density] canvas').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(6400)
  const data = await collect(page)
  const terminal = data.sockets.find(x => x.path.includes('/terminal'))
  const monitor = data.sockets.find(x => x.path.includes('/monitor'))
  const ready = terminal?.messages.find(x => x.type === 'connected')?.time
  const samples = monitor?.messages.filter(x => x.type === 'binary') ?? []
  const dom = Object.fromEntries(data.dom.map(x => [x.name, x.time]))
  const entry = { label, click, terminalReady: ready, clickToReadyMs: ready - click, readyToMonitorSocketMs: monitor?.start - ready, monitorHandshakeMs: monitor?.open - monitor?.start, monitorSshReadyMs: monitor?.messages.find(x => x.type === 'ready')?.time - monitor?.open, readyToFirstMetricsMs: samples[0]?.time - ready, readyToSecondMetricsMs: samples[1]?.time - ready, readyToMonitorMountMs: dom.monitorMounted - ready, firstMetricsToChartMs: dom.chartPaintOpportunity - samples[0]?.time, clickToChartMs: dom.chartPaintOpportunity - click, firstFrame: summarize(data, click, dom.chartPaintOpportunity + 300), data }
  report.connections.push(entry)
  console.log(JSON.stringify({ connection: label, clickToReadyMs: entry.clickToReadyMs, readyToFirstMetricsMs: entry.readyToFirstMetricsMs, firstMetricsToChartMs: entry.firstMetricsToChartMs, coreCollectionMs: samples.map(x => x.sshLatencyMs) }))
  save()
  return cdp
}

let page, cdp
try {
  if (process.env.PERF_WARMUP === '1') {
    page = await context.newPage()
    cdp = await connect(page, 'warmup', false)
  }
  for (const cache of caches) {
    for (let round = 0; round < rounds; round++) {
      if (page) await page.close()
      page = await context.newPage()
      cdp = await connect(page, `${cache}-${round + 1}`, cache === 'cold')
    }
  }
  const main = page.locator('main')
  async function action(name, execute, settleMs = 550) {
    const start = await page.evaluate(() => performance.now())
    await execute()
    const dispatched = await page.evaluate(() => performance.now())
    await page.waitForTimeout(settleMs)
    const end = await page.evaluate(() => performance.now())
    const data = await collect(page)
    const entry = { name, start, end, driverActionMs: dispatched - start, ...summarize(data, start, end) }
    report.actions.push(entry)
    save()
    return entry
  }
  for (const cpuRate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
    for (let i = 0; i < menuRounds; i++) {
      const suffix = `cpu${cpuRate}-${i + 1}`
      for (const name of ['monitor', 'sftp', 'ai']) {
        const label = { monitor: '监控', sftp: '文件管理器', ai: 'AI 助手' }[name]
        // Monitor starts open; SFTP and AI start closed.
        for (const phase of name === 'monitor' ? ['close', 'open'] : ['open', 'close']) {
          await action(`${name}-${phase}-${suffix}`, () => main.getByRole('button', { name: label, exact: true }).click())
        }
      }
      for (const name of ['latency', 'docker']) {
        const label = name === 'latency' ? '网络延迟' : 'Docker 管理'
        await action(`${name}-open-${suffix}`, () => main.getByRole('button', { name: label, exact: true }).click())
        await action(`${name}-close-${suffix}`, () => page.keyboard.press('Escape'))
      }
      await action(`settings-open-${suffix}`, () => main.getByRole('button', { name: '终端设置', exact: true }).click())
      await action(`settings-close-${suffix}`, () => page.locator('[data-slot="dialog-close"]').click())
      await action(`fullscreen-open-${suffix}`, () => main.getByRole('button', { name: '全屏', exact: true }).click())
      await action(`fullscreen-close-${suffix}`, () => main.getByRole('button', { name: '退出全屏', exact: true }).click())
      if (process.env.PERF_CONTEXT_MENU === '1') {
        await action(`context-open-${suffix}`, async () => {
          await page.locator('[data-session-tab-id]:not([data-session-tab-id="__terminal-workspace__"])').first().click({ button: 'right' })
          await page.getByRole('menuitem', { name: '复制会话', exact: true }).waitFor({ state: 'visible' })
        })
        await action(`context-close-${suffix}`, () => page.keyboard.press('Escape'))
      }
      console.log(JSON.stringify({ menus: suffix, actions: report.actions.length }))
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await action('steady-monitor-12s', async () => {}, 12000)
  await action('terminal-output-300-lines', async () => {
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type("for i in $(seq 1 300); do printf 'EasySSH performance sample %s\\n' \"$i\"; done", { delay: 0 })
    await page.keyboard.press('Enter')
  }, 1800)
  report.finalData = await collect(page)
  report.domCounts = await page.evaluate(() => ({ elements: document.querySelectorAll('*').length, charts: document.querySelectorAll('[data-slot="echarts-view"]').length, canvases: document.querySelectorAll('canvas').length }))
  const clip = await main.boundingBox()
  await page.screenshot({ path: output.replace(/\.json$/, '.png'), clip })
  report.completed = true
} catch (error) {
  report.fatal = { message: error.message, stack: error.stack }
  if (page && !page.isClosed()) {
    report.failureUrl = page.url().split('?')[0]
    try {
      report.failureData = await collect(page)
      report.failureText = await page.evaluate(() => (document.querySelector('main')?.innerText || document.body.innerText).slice(0, 4000))
      await page.screenshot({ path: output.replace(/\.json$/, '-failure.png'), timeout: 5000 })
    } catch (captureError) {
      report.failureCaptureError = captureError.message
    }
  }
  console.error(error.message)
  process.exitCode = 1
} finally {
  save()
  await context.storageState({ path: authState })
  fs.chmodSync(authState, 0o600)
  await browser.close()
}
