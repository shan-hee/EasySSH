import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const dir = process.env.AUDIT_OUTPUT_DIR || '/tmp/easyssh-tabs-audit'
const origin = process.env.PERF_ORIGIN || 'http://localhost:5200'
const authFile = process.env.PERF_AUTH_STATE || `${dir}/auth-state.json`
const apiMode = process.env.AUDIT_TRANSFER_MODE === 'api'
const names = [process.env.AUDIT_SERVER || 'PVE-Debian 13', process.env.AUDIT_SECOND_SERVER || 'PVE']
assert.notEqual(names[0], names[1])
const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'))
auth.origins = auth.origins.map(item => ({ ...item, origin }))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ storageState: auth, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
const report = { createdAt: new Date().toISOString(), servers: names, checks: [], transfers: [], cleanup: [] }
const headers = {}, targets = [], created = []
const scratch = `/tmp/easyssh-tabs-audit-${randomUUID()}`
const fileName = '跨服务器 audit.bin'
const payload = Buffer.concat([Buffer.from('EasySSH 双向传输校验\n'), Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256))])
const hash = value => createHash('sha256').update(value).digest('hex')
const save = () => fs.writeFileSync(`${dir}/transfer-functional.json`, JSON.stringify(report, null, 2))
const tab = id => page.locator(`[data-session-tab-id="${id}"]`)
const panel = id => page.locator(`[data-extra-session-id="${id}"]`)
page.on('request', async request => {
  if (new URL(request.url()).pathname.includes('/sftp/')) {
    const all = await request.allHeaders()
    for (const key of ['authorization', 'x-csrf-token']) if (all[key]) headers[key] = all[key]
  }
})
page.on('websocket', socket => {
  if (!socket.url().includes('/sftp/transfer/ws/')) return
  socket.on('framereceived', ({ payload: data }) => {
    try {
      const message = JSON.parse(String(data)), detail = message.data ?? message
      report.transfers.push({ type: message.type, status: detail.status, progress: detail.progress, stage: detail.stage })
    } catch { /* Ignore transport messages without JSON data. */ }
  })
})
async function navigate(target, remotePath) {
  await tab(target.tabId).click()
  if ((await panel(target.tabId).locator('div[data-sftp-glass-control="path"]').innerText()).replace(/\s/g, '') === remotePath) return
  await panel(target.tabId).locator('div[data-sftp-glass-control="path"]').click()
  const input = panel(target.tabId).locator('input[data-sftp-glass-control="path"]')
  await input.fill(remotePath)
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/${target.serverId}/list`) && new URL(r.url()).searchParams.get('path') === remotePath),
    input.press('Enter'),
  ])
  assert.equal(response.status(), 200)
  await page.waitForTimeout(200)
}
async function transfer(source, target, targetPath) {
  await navigate(target, targetPath)
  await tab(source.tabId).click()
  report.phase = 'transfer-start'
  await page.evaluate(() => { window.__auditDrag = []; for (const type of ['dragstart','dragenter','dragover','drop','dragend']) document.addEventListener(type, event => { window.__auditDrag.push({ type, targetTag: event.target?.tagName, tab: !!event.target?.closest('[data-session-tab-id]'), types: [...event.dataTransfer.types], prevented: event.defaultPrevented }); }, {capture: false}) })
  let response
  if (apiMode) {
    response = await context.request.post(`${origin}/api/v1/sftp/transfer/direct`, { headers, data: { source_server_id: source.serverId, source_path: `${scratch}/${fileName}`, target_server_id: target.serverId, target_path: targetPath } })
  } else {
  ;[response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/sftp/transfer/direct')),
    (async () => { const row = await panel(source.tabId).locator('[data-sftp-file-item]').filter({ hasText: fileName }).boundingBox(); const dst = await tab(target.tabId).boundingBox(); await page.mouse.move(row.x + 80, row.y + row.height / 2); await page.mouse.down(); await page.mouse.move(row.x + 90, row.y + row.height / 2, { steps: 3 }); await page.mouse.move(dst.x + 35, dst.y + 16, { steps: 20 }); await page.mouse.move(dst.x + 40, dst.y + 16); await page.mouse.up(); })(),
  ])
  }
  assert.equal(response.status(), 200)
  const request = apiMode ? { source_server_id: source.serverId, target_server_id: target.serverId, target_path: targetPath } : response.request().postDataJSON()
  assert.equal(request.source_server_id, source.serverId)
  assert.equal(request.target_server_id, target.serverId)
  assert.equal(request.target_path, targetPath)
  if (apiMode) {
    const raw = await response.json(), taskId = (raw.data ?? raw).task_id
    report.startResponseKeys = Object.keys(raw); report.startDataKeys = Object.keys(raw.data ?? raw); report.hasTaskId = typeof taskId === 'string'; save(); assert.ok(taskId)
    const ticketResponse = await context.request.post(`${origin}/api/v1/auth/ticket`, { headers, data: { type: 'ws_sftp_transfer', task_id: taskId } })
    assert.equal(ticketResponse.status(), 200)
    const ticketRaw = await ticketResponse.json(), ticket = (ticketRaw.data ?? ticketRaw).ticket
    report.hasTicket = typeof ticket === 'string'; save(); assert.ok(ticket)
    const result = await page.evaluate(({ origin, taskId, ticket }) => new Promise(resolve => {
      const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/v1/sftp/transfer/ws/${taskId}?ticket=${encodeURIComponent(ticket)}`)
      const timer = setTimeout(() => { ws.close(); resolve({status:'timeout'}) }, 5000)
      ws.onerror = () => { clearTimeout(timer); resolve({status:'socket-error'}) }
      ws.onmessage = event => { const message = JSON.parse(event.data), data = message.data ?? message; if (['complete','error','cancelled'].includes(message.type)) { clearTimeout(timer); ws.close(); resolve({status:message.type === 'complete' ? 'completed' : message.type, progress:data.progress, method:data.method}) } }
    }), { origin, taskId, ticket })
    report.transfers.push(result)
    report.checks.push({ name: `${source.name} → ${target.name}：WebSocket收到完成状态`, passed: result.status === 'completed', status: result.status }); if(result.status !== 'completed') { const cancelled = await context.request.post(`${origin}/api/v1/sftp/transfer/${taskId}/cancel`, {headers}); report.cancelStatus = cancelled.status(); const taskCheck = await context.request.get(`${origin}/api/v1/sftp/transfer/ws/${taskId}`, {headers}); report.taskLookupAfterTimeout = {status:taskCheck.status(), body:await taskCheck.json()}; }
    save()
    await tab(target.tabId).click()
    await panel(target.tabId).getByTitle('刷新', { exact: true }).click()
  }
  await panel(target.tabId).getByText(fileName, { exact: true }).first().waitFor({ timeout: 60000 })
  const downloaded = await context.request.get(`${origin}/api/v1/sftp/${target.serverId}/read?path=${encodeURIComponent(`${targetPath}/${fileName}`)}`, { headers })
  assert.equal(downloaded.status(), 200)
  assert.deepEqual(await downloaded.body(), payload)
  report.checks.push({ name: `${source.name} → ${target.name}：${apiMode ? '认证API传输、手动刷新' : '原生拖动页签传输、目标目录自动刷新'}、字节一致`, passed: true, bytes: payload.length, sha256: hash(payload) })
  save()
}
try {
  await page.goto(`${origin}/dashboard/terminal`)
  await page.getByRole('button', { name: '新建会话', exact: true }).waitFor({ timeout: 45000 })
  for (const name of names) {
    const before = await page.locator('[data-session-tab-id]').evaluateAll(xs => xs.map(x => x.dataset.sessionTabId))
    await page.getByRole('button', { name: '选择服务器并打开 SFTP', exact: true }).click()
    await page.locator('input[cmdk-input]').fill(name)
    await page.locator('#sftp-start-directory').selectOption('custom')
    const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) })
    const [listed] = await Promise.all([
      page.waitForResponse(r => /\/sftp\/[^/]+\/list$/.test(new URL(r.url()).pathname)),
      option.click(),
    ])
    assert.equal(listed.status(), 200)
    const serverId = new URL(listed.url()).pathname.split('/').at(-2)
    const tabId = (await page.locator('[data-session-tab-id]').evaluateAll(xs => xs.map(x => x.dataset.sessionTabId))).find(id => !before.includes(id))
    targets.push({ name, serverId, tabId })
    const result = await context.request.post(`${origin}/api/v1/sftp/${serverId}/mkdir`, { headers, data: { path: scratch } })
    assert.equal(result.status(), 200)
    created.push({ serverId, name, path: scratch })
    report.remoteScratchPath = scratch
    save()
    await navigate(targets.at(-1), scratch)
  }
  assert.notEqual(targets[0].serverId, targets[1].serverId)
  await tab(targets[0].tabId).click()
  await panel(targets[0].tabId).locator('input[type=file]').first().setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: payload })
  await panel(targets[0].tabId).getByText(fileName, { exact: true }).first().waitFor()
  await transfer(targets[0], targets[1], scratch)
  const returnPath = `${scratch}/return`
  const result = await context.request.post(`${origin}/api/v1/sftp/${targets[0].serverId}/mkdir`, { headers, data: { path: returnPath } })
  assert.equal(result.status(), 200)
  await transfer(targets[1], targets[0], returnPath)
  report.phase = 'complete'
  if (!apiMode) {
    await panel(targets[0].tabId).getByTitle('传输任务', { exact: true }).click()
    await page.getByText(/^已完成/).first().waitFor()
    report.uiCompletedVisible = true
    report.checks.push({name:'SFTP 任务面板显示已完成',passed:true})
    await page.keyboard.press('Escape')
  }
} catch (error) {
  report.dragEvents = await page.evaluate(() => window.__auditDrag ?? []); report.dialogCount = await page.getByRole('dialog').count(); report.fatal = error.message.slice(0, 1500)
  console.log(`未完成：${error.message.slice(0, 250)}`)
} finally {
  for (const target of created) {
    try {
      const response = await context.request.post(`${origin}/api/v1/sftp/${target.serverId}/delete-paths`, { headers, data: { paths: [target.path] } })
      const listed = await context.request.get(`${origin}/api/v1/sftp/${target.serverId}/list?path=%2Ftmp`, { headers })
      const json = await listed.json()
      report.cleanup.push({ server: target.name, status: response.status(), verifiedAbsent: listed.ok() && !(json.data ?? json).files.some(file => file.name === target.path.split('/').at(-1)) })
    } catch (error) {
      report.cleanup.push({ server: target.name, verifiedAbsent: false, error: error.message, remainingPath: target.path })
    }
  }
  save()
  await context.storageState({ path: authFile })
  fs.chmodSync(authFile, 0o600)
  await browser.close()
  console.log(JSON.stringify(report))
}

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
