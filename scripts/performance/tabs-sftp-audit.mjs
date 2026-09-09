import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const outputDir = process.env.AUDIT_OUTPUT_DIR || '/tmp/easyssh-tabs-audit'
const origin = process.env.PERF_ORIGIN || 'http://localhost:5200'
const target = process.env.AUDIT_SERVER || 'PVE-Debian 13'
const auth = JSON.parse(fs.readFileSync(process.env.PERF_AUTH_STATE || `${outputDir}/auth-state.json`, 'utf8'))
auth.origins = auth.origins.map(item => ({ ...item, origin, localStorage: item.localStorage.filter(x => x.name !== 'tab-ui-storage') }))
fs.mkdirSync(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const context = await browser.newContext({ storageState: auth, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(12000)
const report = { createdAt: new Date().toISOString(), origin, browser: browser.version(), checks: [], requests: [], errors: [], screenshots: [] }
let section = ''
page.on('response', response => { const url = new URL(response.url()); if (response.status() >= 400) report.errors.push({ section, path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), status: response.status() }) })
page.on('pageerror', error => report.errors.push({ section, message: error.message }))
page.on('requestfailed', request => report.errors.push({ section, path: new URL(request.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), failure: request.failure()?.errorText }))
page.on('request', request => {
 const pathname = new URL(request.url()).pathname
 if (pathname.includes('/sftp/')) report.requests.push({ section, method: request.method(), path: pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), at: Date.now() })
})
const save = () => fs.writeFileSync(path.join(outputDir, 'functional.json'), JSON.stringify(report, null, 2))
const check = async (name, fn) => {
 try { const detail = await fn(); report.checks.push({ section, name, passed: true, detail }); console.log(`PASS ${name}`) }
 catch (error) { report.checks.push({ section, name, passed: false, error: error.message.slice(0, 1400) }); console.log(`FAIL ${name}: ${error.message.slice(0, 160)}`) }
 save()
}
const snapshot = async name => { await page.screenshot({ path: path.join(outputDir, `${name}.png`) }); report.screenshots.push(name); save() }
const tabs = () => page.locator('[data-session-tab-id]')
const tab = id => page.locator(`[data-session-tab-id="${id}"]`)
const panel = id => page.locator(`[data-extra-session-id="${id}"]`)
const count = suffix => report.requests.filter(x => x.path.endsWith(suffix)).length
const reset = async name => {
 if (!section) {
  await page.goto(`${origin}/dashboard/terminal`)
 } else {
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({state:'hidden'})
  await page.waitForTimeout(200)
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  for (let i = 0; i < 12 && await tabs().count(); i++) {
   const first = tabs().first()
   if (!(await first.getByRole('button', { name: '关闭标签页', exact: true }).count())) await first.dblclick()
   await first.hover(); await first.getByRole('button', { name: '关闭标签页', exact: true }).click()
   await page.waitForTimeout(150)
  }
 }
 section = name
 await page.getByRole('button', { name: '新建会话', exact: true }).waitFor({ timeout: 45000 })
 await page.waitForTimeout(350)
}
const addSftp = async () => {
 const before = new Set(await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId)))
 await page.getByRole('button', { name: '选择服务器并打开 SFTP', exact: true }).click()
 await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({ hasText: target }).click()
 await page.waitForFunction(before => [...document.querySelectorAll('[data-session-tab-id]')].some(x => !before.includes(x.dataset.sessionTabId)), [...before])
 const id = (await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId))).find(x => !before.has(x))
 await panel(id).locator('[data-sftp-file-item]').first().waitFor({ timeout: 25000 })
 return id
}
const addTerminal = async () => {
 const before = new Set(await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId)))
 await page.getByRole('button', { name: '新建会话', exact: true }).click()
 await page.getByText(target, { exact: true }).last().dblclick()
 await page.waitForFunction(before => [...document.querySelectorAll('[data-session-tab-id]')].some(x => !before.includes(x.dataset.sessionTabId)), [...before])
 const id = (await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId))).find(x => !before.has(x))
 await page.locator(`[data-split-session-id="${id}"] .xterm`).first().waitFor({ timeout: 25000 })
 await page.waitForTimeout(1000)
 return id
}
const dragTab = async (id, dest, side = 'right') => {
 await tab(id).hover()
 const a = await tab(id).boundingBox(), b = await dest.boundingBox()
 assert.ok(a && b)
 const x = side === 'left' ? b.x + 25 : side === 'right' ? b.x + b.width - 25 : b.x + b.width / 2
 const y = side === 'top' ? b.y + 25 : side === 'bottom' ? b.y + b.height - 25 : b.y + b.height / 2
 await page.mouse.move(a.x + 30, a.y + a.height / 2)
 await page.mouse.down()
 await page.mouse.move(a.x + 30, a.y + a.height / 2 + 12, { steps: 4 })
 await page.mouse.move(x, y, { steps: 22 })
 await page.waitForTimeout(200)
 await page.mouse.up()
 await page.waitForTimeout(700)
}
try {
 await reset('ordinary-sftp')
 await check('默认首页没有占位页签，新增入口为加号', async () => { assert.equal(await tabs().count(), 0); assert.equal(await page.getByRole('button', { name: '新建会话', exact: true }).innerText(), '') })
 const a = await addSftp(), b = await addSftp()
 await check('同一服务器可打开两个独立 SFTP 页签', async () => { assert.notEqual(a, b); assert.equal(await tabs().count(), 2); assert.equal(await page.locator('[data-extra-session-id]').count(), 2) })
 await tab(a).click()
 await panel(a).getByText('etc', { exact: true }).dblclick()
 await panel(a).getByTitle('返回上一步', { exact: true }).waitFor()
 await page.waitForFunction(id => !document.querySelector(`[data-extra-session-id="${id}"] button[title="返回上一步"]`)?.disabled, a, { timeout: 30000 })
 const firstRow = panel(a).locator('[data-sftp-file-item]').first()
 await firstRow.click()
 const rowHandle = await firstRow.elementHandle()
 const rootHandle = await panel(a).elementHandle()
 const beforeLists = count('/list'), beforeCloses = count('/close')
 await check('SFTP 普通页签切换 10 次不重载目录、不关闭连接、保留选中状态', async () => {
  for (let i = 0; i < 5; i++) { await tab(b).click(); await tab(a).click() }
  await page.waitForTimeout(500)
  assert.equal(count('/list') - beforeLists, 0)
  assert.equal(count('/close') - beforeCloses, 0)
  assert.ok(await rootHandle.evaluate(x => x.isConnected))
  assert.equal(await rowHandle.getAttribute('data-selected'), 'true')
  return { switches: 10, listRequests: 0, closeRequests: 0 }
 })
 await check('SFTP 目录前进和后退可用', async () => {
  await panel(a).getByTitle('返回上一步', { exact: true }).click()
  await panel(a).getByText('etc', { exact: true }).waitFor()
  await page.waitForFunction(id => !document.querySelector(`[data-extra-session-id="${id}"] button[title="前进到下一步"]`)?.disabled, a, { timeout: 15000 })
  await panel(a).getByTitle('前进到下一步', { exact: true }).click()
  await page.waitForTimeout(600)
  assert.ok(await panel(a).getByTitle('返回上一步', { exact: true }).isEnabled())
 })
 await check('切到连接配置再返回 SFTP 不重新加载', async () => {
  const before = count('/list')
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByRole('button', { name: '添加服务器', exact: true }).waitFor()
  await tab(a).click(); await page.waitForTimeout(400)
  assert.equal(count('/list'), before)
 })
 await check('隐藏 SFTP 面板不可交互，当前面板仍可刷新', async () => {
  assert.equal(await panel(b).getAttribute('inert'), '')
  const response = page.waitForResponse(r => /\/sftp\/[^/]+\/list/.test(r.url()), { timeout: 30000 })
  await panel(a).getByTitle('刷新', { exact: true }).click()
  assert.equal((await response).status(), 200)
 })
 await check('SFTP 页签拖动排序', async () => {
  const before = await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId))
  const src = await tab(a).boundingBox(), dst = await tab(b).boundingBox()
  await page.mouse.move(src.x + 20, src.y + src.height / 2); await page.mouse.down()
  await page.mouse.move(dst.x + dst.width - 15, dst.y + dst.height / 2, { steps: 20 }); await page.mouse.up()
  await page.waitForTimeout(350)
  assert.notDeepEqual(await tabs().evaluateAll(xs => xs.map(x => x.dataset.sessionTabId)), before)
 })
 await check('关闭同服务器一个 SFTP 页签不会发出服务器级关闭请求', async () => {
  const before = count('/close')
  await tab(b).hover(); await tab(b).getByRole('button', { name: '关闭标签页', exact: true }).click()
  await page.waitForTimeout(500)
  assert.equal(await tabs().count(), 1)
  assert.equal(count('/close') - before, 0)
 })
 await check('关闭另一个页签后剩余 SFTP 仍能读取目录', async () => {
  await tab(a).click()
  const response = page.waitForResponse(r => /\/sftp\/[^/]+\/list/.test(r.url()), { timeout: 30000 })
  await panel(a).getByTitle('刷新', { exact: true }).click()
  assert.equal((await response).status(), 200)
 })
 await reset('sftp-workspace')
 const wa = await addSftp(), wb = await addSftp()
 await check('两个 SFTP 页签拖动合并成工作空间', async () => {
  await dragTab(wa, panel(wb))
  assert.equal(await tab('__terminal-workspace__').count(), 1)
  assert.equal(await page.locator('[data-split-session-id]').count(), 2)
 })
 if (await tab('__terminal-workspace__').count()) {
  await snapshot('sftp-workspace')
  await check('分屏宽度拖动调整', async () => {
   const separator = page.getByRole('separator').filter({ has: page.locator('svg') }).last()
   const box = await separator.boundingBox()
   const pane = page.locator('[data-split-session-id]').first()
   const before = (await pane.boundingBox()).width
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
   await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300)
   assert.ok(Math.abs((await pane.boundingBox()).width - before) > 50)
  })
  await check('合并工作空间切走再返回保留 SFTP 实例且不重新加载', async () => {
   const element = await page.locator('[data-split-session-id] [data-sftp-product-shell]').first().elementHandle()
   const before = { list: count('/list'), close: count('/close') }
   await page.getByRole('button', { name: '新建会话', exact: true }).click(); await page.waitForTimeout(250)
   await tab('__terminal-workspace__').click(); await page.waitForTimeout(800)
   const detail = { listRequests: count('/list') - before.list, closeRequests: count('/close') - before.close, retained: await element.evaluate(x => x.isConnected) }
   report.workspaceRemount = detail; assert.deepEqual(detail, { listRequests: 0, closeRequests: 0, retained: true }); return detail
  })
  await check('分屏拖回加号所在页签栏后恢复独立页签', async () => {
   await page.locator(`[data-dockview-session-id="${wa}"]`).dragTo(page.getByRole('button', { name: '新建会话', exact: true }))
   await page.waitForTimeout(600)
   assert.equal(await tab('__terminal-workspace__').count(), 0)
   assert.equal(await tabs().count(), 2)
  })
  if (!(await tab('__terminal-workspace__').count())) { await tab(wb).click(); await dragTab(wa, panel(wb)) }
  await check('关闭一个分屏后另一会话恢复为普通页签', async () => {
   await page.locator('[data-workspace-pane-session-id]').first().getByRole('button', { name: '关闭连接', exact: true }).click()
   await page.waitForTimeout(650)
   assert.equal(await tab('__terminal-workspace__').count(), 0); assert.equal(await tabs().count(), 1)
   await page.locator('[data-extra-session-id]:visible [data-sftp-file-item]').first().waitFor({ timeout: 30000 })
  })
 }
 await reset('mixed-tabs')
 const st = await addSftp(), tt = await addTerminal()
 await tab(st).click()
 await check('将终端拖到当前 SFTP 面板能合并混合工作空间', async () => {
  await dragTab(tt, panel(st), 'left')
  assert.equal(await tab('__terminal-workspace__').count(), 1)
 })
 if (await tab('__terminal-workspace__').count()) {
  await page.locator(`[data-dockview-session-id="${st}"]`).dragTo(page.getByRole('button', { name: '新建会话', exact: true }))
  await tab(st).waitFor()
 }
 if (!(await tab('__terminal-workspace__').count())) {
  await tab(tt).click()
  await check('将 SFTP 拖到当前终端面板能合并混合工作空间', async () => {
   await dragTab(st, page.locator(`[data-split-session-id="${tt}"]`), 'right')
   assert.equal(await tab('__terminal-workspace__').count(), 1)
  })
 }
 await snapshot('mixed-workspace')
 await reset('tab-menus')
 const ms = await addSftp(), mt = await addTerminal()
 await check('当前终端可直接打开同主机 SFTP，无需再次选择服务器', async () => {
  const before = await tabs().count()
  await tab(mt).click({ button: 'right' }); await page.getByRole('menuitem', { name: '在 SFTP 页签中打开', exact: true }).click()
  await page.locator('[data-extra-session-id]:visible [data-sftp-file-item]').first().waitFor()
  assert.equal(await tabs().count(), before + 1)
  assert.equal(await page.getByRole('dialog').count(), 0)
  await tabs().last().hover(); await tabs().last().getByRole('button', { name: '关闭标签页', exact: true }).click()
 })
 await check('终端右键复制会话', async () => {
  await tab(mt).click({ button: 'right' }); await page.getByRole('menuitem', { name: '复制会话', exact: true }).click()
  await page.waitForTimeout(600); assert.equal(await tabs().count(), 3)
 })
 await check('终端页签固定后隐藏关闭按钮，取消固定后恢复', async () => {
  await tab(mt).dblclick(); await page.waitForTimeout(150)
  assert.equal(await tab(mt).getByRole('button', { name: '关闭标签页', exact: true }).count(), 0)
  await tab(mt).dblclick(); await page.waitForTimeout(150)
  assert.equal(await tab(mt).getByRole('button', { name: '关闭标签页', exact: true }).count(), 1)
 })
 await check('混合页签的关闭全部会关闭所有未固定会话', async () => {
  await tab(mt).click({ button: 'right' }); await page.getByRole('menuitem', { name: '全部关闭', exact: true }).click()
  await page.waitForTimeout(700)
  assert.equal(await tabs().count(), 0)
 })
 await check('SFTP 页签提供与终端一致的会话右键菜单', async () => {
  const menuSftp = await tab(ms).count() ? ms : await addSftp()
  await tab(menuSftp).click({ button: 'right' }); assert.equal(await page.getByRole('menuitem').count() > 0, true)
  await page.keyboard.press('Escape')
 })
 await reset('picker-fault-injection')
 await page.route('**/api/v1/servers?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'audit_injected_failure' }) }))
 await check('服务器选择弹窗区分加载失败与搜索无结果（注入 500）', async () => {
  await page.getByRole('button', { name: '选择服务器并打开 SFTP', exact: true }).click(); await page.getByText('服务器列表加载失败', { exact: true }).waitFor({ timeout: 30000 })
  const text = await page.getByRole('dialog').innerText()
  assert.match(text, /失败|重试|错误/)
 })
 await snapshot('picker-error')
 await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click(); await page.unrouteAll({ behavior: 'wait' })
 await reset('responsive')
 const mobile = await addSftp()
 await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(450)
 await check('390px 下 SFTP 页面不产生整页横向溢出', async () => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false) })
 await snapshot('sftp-mobile')
 await page.setViewportSize({ width: 1440, height: 900 })
 await check('最后一个 SFTP 页签关闭后回到连接配置', async () => {
  await tab(mobile).hover(); await tab(mobile).getByRole('button', { name: '关闭标签页', exact: true }).click()
  await page.getByRole('button', { name: '添加服务器', exact: true }).waitFor(); assert.equal(await tabs().count(), 0)
 })
} catch (error) { report.fatal = { section, path: new URL(page.url()).pathname, message: error.message }; await snapshot('fatal').catch(() => {}); console.log(`FATAL ${section}: ${error.message.slice(0, 250)}`) }
finally { save(); await context.storageState({ path: process.env.PERF_AUTH_STATE || `${outputDir}/auth-state.json` }); fs.chmodSync(process.env.PERF_AUTH_STATE || `${outputDir}/auth-state.json`, 0o600); await browser.close(); console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(x => x.passed).length, failed: report.checks.filter(x => !x.passed).length, fatal: !!report.fatal })) }

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
