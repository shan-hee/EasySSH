import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const dir = process.env.AUDIT_OUTPUT_DIR || '/tmp/easyssh-tabs-fix', origin = process.env.PERF_ORIGIN || 'http://localhost:5200'
const authFile = process.env.PERF_AUTH_STATE || `${dir}/auth-state.json`
const state = JSON.parse(fs.readFileSync(authFile, 'utf8')); state.origins = state.origins.map(item => ({...item, origin}))
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',args:['--no-sandbox']})
const context = await browser.newContext({storageState:state,viewport:{width:1440,height:900}}), page = await context.newPage()
page.setDefaultTimeout(20000)
const report = {checks:[],createdAt:new Date().toISOString()}, headers = {}
const scratch = `/tmp/easyssh-tabs-audit-${randomUUID()}`
let serverId, created = false, writes = 0, lists = 0
const tab = id => page.locator(`[data-session-tab-id="${id}"]`), panel = id => page.locator(`[data-extra-session-id="${id}"]`)
const save = () => fs.writeFileSync(`${dir}/state-regression.json`,JSON.stringify(report,null,2))
const passed = name => { report.checks.push({name,passed:true}); save(); console.log(`PASS ${name}`) }
page.on('request',async request => {
 const url = new URL(request.url())
 if(url.pathname.endsWith('/write'))writes++
 if(/\/sftp\/[^/]+\/list$/.test(url.pathname)){serverId=url.pathname.split('/').at(-2); lists++}
 if(url.pathname.includes('/sftp/')) { const all=await request.allHeaders(); for(const key of ['authorization','x-csrf-token'])if(all[key])headers[key]=all[key] }
})
async function add(mode='custom') {
 const before=await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))
 await page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true}).click()
 await page.locator('#sftp-start-directory').selectOption(mode)
 await page.getByRole('option').filter({hasText:process.env.AUDIT_SERVER || 'PVE-Debian 13'}).click()
 const id=(await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))).find(x=>!before.includes(x))
 await page.waitForFunction(id=>!!document.querySelector(`[data-session-tab-id="${id}"] .bg-green-500`),id)
 await panel(id).waitFor({state:"visible"})
 return id
}
async function navigate(id,path) {
 await panel(id).locator('div[data-sftp-glass-control="path"]').click()
 const input=panel(id).locator('input[data-sftp-glass-control="path"]'); await input.fill(path)
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).searchParams.get('path')===path&&r.url().includes('/list')),input.press('Enter')])
 assert.equal(response.status(),200)
}
try {
 await page.goto(`${origin}/dashboard/terminal`); await page.getByRole('button',{name:'新建会话',exact:true}).waitFor({timeout:45000})
 const a=await add()
 const createdResponse=await context.request.post(`${origin}/api/v1/sftp/${serverId}/mkdir`,{headers,data:{path:scratch}})
 assert.equal(createdResponse.status(),200); created=true; report.remoteScratchPath=scratch; save()
 await navigate(a,scratch)
 await panel(a).locator('input[type=file]').first().setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('original\n')})
 await panel(a).getByText('draft.txt',{exact:true}).dblclick()
 await panel(a).locator('.monaco-editor .view-lines').click({position:{x:60,y:10}})
 await page.keyboard.press('Control+Home'); await page.keyboard.type('Draft',{delay:40}); await page.keyboard.press('Enter')
 const editor=await panel(a).locator('.monaco-editor').elementHandle()
 await panel(a).getByRole('button',{name:'保存',exact:true}).waitFor()
 const b=await add()
 const before=writes; await panel(b).locator('[data-sftp-file-item]').first().click(); await page.keyboard.press('Control+s'); await page.waitForTimeout(200)
 assert.equal(writes,before); passed('隐藏编辑器不响应其他页签的保存快捷键')
 const src=await tab(a).boundingBox(), dst=await panel(b).boundingBox()
 await page.mouse.move(src.x+30,src.y+15); await page.mouse.down(); await page.mouse.move(src.x+30,src.y+30,{steps:4}); await page.mouse.move(dst.x+dst.width-20,dst.y+dst.height/2,{steps:20}); await page.mouse.up()
 await tab('__terminal-workspace__').waitFor(); assert.ok(await editor.evaluate(el=>el.isConnected))
 await page.getByRole('button',{name:'新建会话',exact:true}).click(); await tab('__terminal-workspace__').click()
 assert.ok(await editor.evaluate(el=>el.isConnected)); passed('合并、工作空间往返保留同一个未保存编辑器')
 await page.locator(`[data-dockview-session-id="${a}"]`).dragTo(page.getByRole('button',{name:'新建会话',exact:true}))
 await tab(a).click(); assert.ok(await editor.evaluate(el=>el.isConnected))
 await panel(a).getByRole('button',{name:'保存',exact:true}).click()
 const remote=await context.request.get(`${origin}/api/v1/sftp/${serverId}/read?path=${encodeURIComponent(scratch+'/draft.txt')}`,{headers})
 assert.equal(await remote.text(),'Draft\noriginal\n'); passed('拆回普通页签后保存，草稿与换行完整保留')
 await tab(a).dblclick()
 await tab(a).click({button:'middle'}); assert.equal(await tab(a).count(),1)
 await tab(b).click({button:'right'}); await page.getByRole('menuitem',{name:'关闭其他',exact:true}).click()
 assert.equal(await tab(a).count(),1); assert.equal(await tab(b).count(),1); passed('SFTP 固定页签不被中键或关闭其他移除')
 await tab(b).click({button:'right'}); await page.getByRole('menuitem',{name:'全部关闭',exact:true}).click()
 await tab(b).waitFor({state:'detached'}); assert.equal(await tab(a).count(),1); passed('全部关闭保留固定 SFTP')
 const home=await add('home')
 await panel(home).locator('div[data-sftp-glass-control="path"]').click()
 const homePath=await panel(home).locator('input[data-sftp-glass-control="path"]').inputValue()
 await page.keyboard.press('Escape')
 assert.ok(homePath.trim().startsWith('/')); assert.notEqual(homePath.trim(),'~'); passed('主目录经服务器解析为真实绝对路径')
 await tab(a).click(); await tab(home).click(); await page.waitForTimeout(200)
 const lastRemembered=await page.evaluate(serverId=>JSON.parse(localStorage.getItem('easyssh:sftp:connection-history')).find(item=>item.serverId===serverId)?.path,serverId)
 assert.equal(lastRemembered,homePath); passed('同主机隐藏页签不会覆盖当前活跃页签的最近目录')
 await navigate(home,scratch)
 const recent=await add('last')
 await panel(recent).locator('div[data-sftp-glass-control="path"]').click(); assert.equal(await panel(recent).locator('input[data-sftp-glass-control="path"]').inputValue(),scratch); passed('新 SFTP 可从该主机上次目录继续')
 await page.keyboard.press('Escape')
 const beforeTerminal=await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))
 await page.getByRole('button',{name:'新建会话',exact:true}).click()
 await page.getByText(process.env.AUDIT_SERVER || 'PVE-Debian 13',{exact:true}).last().dblclick()
 const terminal=(await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))).find(id=>!beforeTerminal.includes(id))
 await page.waitForFunction(id=>!!document.querySelector(`[data-session-tab-id="${id}"] .bg-green-500`),terminal)
 const terminalPane=page.locator(`[data-split-session-id="${terminal}"]`), inline=terminalPane.locator('aside[data-terminal-panel]')
 if(!await inline.isVisible())await page.getByRole('button',{name:'文件管理器',exact:true}).click()
 await inline.locator('[data-sftp-file-item]').first().waitFor()
 await inline.locator('div[data-sftp-glass-control="path"]').click()
 const inlinePath=inline.locator('input[data-sftp-glass-control="path"]');await inlinePath.fill(scratch);await inlinePath.press('Enter')
 await inline.getByText('draft.txt',{exact:true}).dblclick()
 await inline.locator('.monaco-editor .view-lines').click({position:{x:60,y:10}})
 await page.keyboard.press('Control+Home');await page.keyboard.type('Inline-')
 const inlineEditor=await inline.locator('.monaco-editor').elementHandle(), beforeSwitch=lists
 await tab(recent).click();await tab(terminal).click();await page.waitForTimeout(300)
 assert.equal(lists,beforeSwitch);assert.ok(await inlineEditor.evaluate(el=>el.isConnected));passed('终端内嵌 SFTP 切换页签保留编辑器且不重新读取目录')
 await tab(recent).click()
 const terminalTab=await tab(terminal).boundingBox(),targetPane=await panel(recent).boundingBox()
 await page.mouse.move(terminalTab.x+30,terminalTab.y+15);await page.mouse.down();await page.mouse.move(terminalTab.x+30,terminalTab.y+30,{steps:4});await page.mouse.move(targetPane.x+targetPane.width-20,targetPane.y+targetPane.height/2,{steps:20});await page.mouse.up()
 await tab('__terminal-workspace__').waitFor();assert.ok(await inlineEditor.evaluate(el=>el.isConnected));assert.equal(lists,beforeSwitch)
 await inline.getByRole('button',{name:'保存',exact:true}).click()
 const inlineRemote=await context.request.get(`${origin}/api/v1/sftp/${serverId}/read?path=${encodeURIComponent(scratch+'/draft.txt')}`,{headers})
 assert.equal(await inlineRemote.text(),'Inline-Draft\noriginal\n');passed('终端内嵌 SFTP 合并后保留草稿并可完整保存')
} catch(error) {report.fatal=error.message; console.log(`FAIL ${error.message.slice(0,300)}`)}
finally {
 if(created) {
  const response=await context.request.post(`${origin}/api/v1/sftp/${serverId}/delete-paths`,{headers,data:{paths:[scratch]}})
  const responseList=await context.request.get(`${origin}/api/v1/sftp/${serverId}/list?path=%2Ftmp`,{headers}),json=await responseList.json()
  report.cleanup={status:response.status(),verifiedAbsent:responseList.ok()&&!(json.data??json).files.some(file=>file.name===scratch.split('/').at(-1))}
 }
 save(); await context.storageState({path:authFile}); fs.chmodSync(authFile,0o600); await browser.close()
}

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
