import fs from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const dir=process.env.AUDIT_OUTPUT_DIR||'/tmp/easyssh-tabs-audit',origin=process.env.PERF_ORIGIN||'http://localhost:5200',authFile=process.env.PERF_AUTH_STATE||`${dir}/auth-state.json`
const auth=JSON.parse(fs.readFileSync(authFile,'utf8'));auth.origins=auth.origins.map(x=>({...x,origin}))
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',args:['--no-sandbox']})
const context=await browser.newContext({storageState:auth,viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(25000)
const report={createdAt:new Date().toISOString(),checks:[]};const save=()=>fs.writeFileSync(`${dir}/workspace-functional.json`,JSON.stringify(report,null,2));const check=async(name,fn)=>{try{report.checks.push({name,passed:true,detail:await fn()});console.log(`PASS ${name}`)}catch(e){report.checks.push({name,passed:false,error:e.message.slice(0,1100)});console.log(`FAIL ${name}: ${e.message.slice(0,160)}`)}save()}
const tabs=()=>page.locator('[data-session-tab-id]'),tab=id=>page.locator(`[data-session-tab-id="${id}"]`),panel=id=>page.locator(`[data-extra-session-id="${id}"]`),plus=()=>page.getByRole('button',{name:'新建会话',exact:true})
const add=async()=>{const before=await tabs().evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId));await page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true}).click();await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({hasText:process.env.AUDIT_SERVER||'PVE-Debian 13'}).click();const id=(await tabs().evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))).find(x=>!before.includes(x));await panel(id).locator('[data-sftp-file-item]').first().waitFor();return id}
const merge=async(a,b)=>{await tab(b).click();const s=await tab(a).boundingBox(),d=await panel(b).boundingBox();await page.mouse.move(s.x+30,s.y+15);await page.mouse.down();await page.mouse.move(s.x+30,s.y+30,{steps:4});await page.mouse.move(d.x+d.width-20,d.y+d.height/2,{steps:20});await page.mouse.up();await tab('__terminal-workspace__').waitFor();await page.locator('[data-split-session-id] [data-sftp-file-item]').first().waitFor()}
try{
 await page.goto(`${origin}/dashboard/terminal`);await plus().waitFor({timeout:45000});const a=await add(),b=await add();await merge(a,b)
 await check('分屏快捷键只作用于获得焦点的右侧面板',async()=>{const panes=page.locator('[data-split-session-id]');await panes.nth(1).locator('[data-sftp-file-item]').first().click();await page.keyboard.press('Control+a');await page.waitForTimeout(300);const selected=await panes.evaluateAll(xs=>xs.map(x=>x.querySelectorAll('[data-selected=true]').length));report.keyboardSelection=selected;await page.locator('main').screenshot({path:`${dir}/workspace-main.png`});assert.equal(selected[0],0);assert.ok(selected[1]>1)})
 await page.keyboard.press('Escape')
 await check('分屏标题拖回加号处可拆回两个独立页签',async()=>{await page.locator(`[data-dockview-session-id="${a}"]`).dragTo(plus());await page.waitForTimeout(500);assert.equal(await tab('__terminal-workspace__').count(),0);assert.equal(await tabs().count(),2);await panel(a).locator('[data-sftp-file-item]').first().waitFor()})
 if(!await tab('__terminal-workspace__').count())await merge(a,b)
 await check('关闭一个分屏后剩余 SFTP 可继续读取',async()=>{await page.locator(`[data-workspace-pane-session-id="${a}"]`).getByRole('button',{name:'关闭连接',exact:true}).click();await panel(b).locator('[data-sftp-file-item]').first().waitFor();assert.equal(await tabs().count(),1);const r=page.waitForResponse(r=>/\/sftp\/[^/]+\/list/.test(r.url()));await panel(b).getByTitle('刷新',{exact:true}).click();assert.equal((await r).status(),200)})
 await check('最后一个 SFTP 关闭后回到无页签首页',async()=>{await tab(b).hover();await tab(b).getByRole('button',{name:'关闭标签页',exact:true}).click();await page.getByRole('button',{name:'添加服务器',exact:true}).waitFor();assert.equal(await tabs().count(),0)})
 await page.route('**/sftp/*/list?**',async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,1500));await route.fulfill({response})})
 await check('SFTP 首次目录响应前不会显示已连接绿点',async()=>{await page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true}).click();await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({hasText:process.env.AUDIT_SERVER||'PVE-Debian 13'}).click();await tabs().first().waitFor();assert.equal(await tabs().first().locator('.bg-green-500').count(),0)})
 await page.unrouteAll({behavior:'wait'})
}catch(e){report.fatal=e.message;console.log(`FATAL ${e.message.slice(0,180)}`)}finally{save();await context.storageState({path:authFile});fs.chmodSync(authFile,0o600);await browser.close();console.log(JSON.stringify({checks:report.checks.length,fatal:!!report.fatal}))}

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
