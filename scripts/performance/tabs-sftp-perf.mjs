import fs from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const dir=process.env.AUDIT_OUTPUT_DIR||'/tmp/easyssh-tabs-audit',origin=process.env.PERF_ORIGIN||'http://localhost:5200',authFile=process.env.PERF_AUTH_STATE||`${dir}/auth-state.json`
const state=JSON.parse(fs.readFileSync(authFile,'utf8'));state.origins=state.origins.map(x=>({...x,origin}))
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
const context=await browser.newContext({storageState:state,viewport:{width:1440,height:900}})
await context.addInitScript(()=>{window.__sftpAudit={frames:[],longTasks:[]};const frame=t=>{window.__sftpAudit.frames.push(t);requestAnimationFrame(frame)};requestAnimationFrame(frame);new PerformanceObserver(list=>{for(const e of list.getEntries())window.__sftpAudit.longTasks.push({start:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true})})
const page=await context.newPage();page.setDefaultTimeout(25000);const cdp=await context.newCDPSession(page)
const report={createdAt:new Date().toISOString(),browser:browser.version(),viewport:{width:1440,height:900},actions:[],errors:[],directoryResponses:[],memory:[],checks:[]};const requests=[]
page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.endsWith('/list')||p.endsWith('/close'))requests.push({path:p.endsWith('/list')?'list':'close',at:Date.now()})})
page.on('response',async r=>{const u=new URL(r.url());if(/\/sftp\/[^/]+\/list$/.test(u.pathname)){try{const raw=await r.json();report.directoryResponses.push({status:r.status(),entries:(raw.data??raw).files?.length,duration:r.request().timing().responseEnd})}catch{}}})
page.on('pageerror',e=>report.errors.push(e.message))
const save=()=>fs.writeFileSync(`${dir}/performance.json`,JSON.stringify(report,null,2))
const q=(xs,p)=>{const s=xs.toSorted((a,b)=>a-b);return s.length?s[Math.ceil(s.length*p)-1]:null}
const tab=id=>page.locator(`[data-session-tab-id="${id}"]`),panel=id=>page.locator(`[data-extra-session-id="${id}"]`)
const measure=async(name,cpu,fn)=>{const start=await page.evaluate(()=>performance.now()),n=requests.length;await fn();await page.waitForTimeout(650);const end=await page.evaluate(()=>performance.now());const d=await page.evaluate(()=>window.__sftpAudit);const frames=d.frames.slice(1).map((t,i)=>({t,dt:t-d.frames[i]})).filter(x=>x.t>=start&&x.t<=end).map(x=>x.dt);const long=d.longTasks.filter(x=>x.start<end&&x.start+x.duration>start);report.actions.push({name,cpu,start,end,frames,frameP95Ms:q(frames,.95),frameMaxMs:Math.max(...frames),framesOver25:frames.filter(x=>x>25).length,longTasks:long,listRequests:requests.slice(n).filter(x=>x.path==='list').length,closeRequests:requests.slice(n).filter(x=>x.path==='close').length});save()}
const memory=async label=>{await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');const dom=await cdp.send('Memory.getDOMCounters');report.memory.push({label,heap,dom});save()}
const addSftp=async()=>{const before=await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId));await page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true}).click();await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({hasText:process.env.AUDIT_SERVER||'PVE-Debian 13'}).click();const id=(await page.locator('[data-session-tab-id]').evaluateAll(xs=>xs.map(x=>x.dataset.sessionTabId))).find(x=>!before.includes(x));await panel(id).locator('[data-sftp-file-item]').first().waitFor();return id}
try{
 await page.goto(`${origin}/dashboard/terminal`);await page.getByRole('button',{name:'新建会话',exact:true}).waitFor({timeout:45000});await memory('home')
 const a=await addSftp();await panel(a).locator('div[data-sftp-glass-control="path"]').click();const input=panel(a).locator('input[data-sftp-glass-control="path"]');await input.fill('/usr/bin');const listed=page.waitForResponse(r=>r.url().includes('/list')&&new URL(r.url()).searchParams.get('path')==='/usr/bin');await input.press('Enter');assert.equal((await listed).status(),200);await page.waitForTimeout(500)
 const b=await addSftp();await memory('two-sftp-tabs')
 for(const cpu of [1,4]){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});await page.waitForTimeout(400)
  for(let i=0;i<12;i++)await measure('ordinary-sftp-switch',cpu,()=>tab(i%2?a:b).click())
  for(let i=0;i<4;i++){
   await measure('sftp-picker-open',cpu,()=>page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true}).click())
   await measure('sftp-picker-close',cpu,()=>page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click())
  }
  console.log(`完成 CPU ${cpu}x：普通切换和连接弹窗 20 个窗口`)
 }
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await tab(b).click();const src=await tab(a).boundingBox(),dst=await panel(b).boundingBox();await page.mouse.move(src.x+30,src.y+15);await page.mouse.down();await page.mouse.move(src.x+30,src.y+30,{steps:4});await page.mouse.move(dst.x+dst.width-25,dst.y+dst.height/2,{steps:20});await page.mouse.up();await tab('__terminal-workspace__').waitFor();await page.waitForTimeout(1200)
 const panes=page.locator('[data-split-session-id]');await panes.nth(1).locator('[data-sftp-file-item]').first().click();await page.keyboard.press('Control+a');await page.waitForTimeout(200);const selected=await panes.evaluateAll(xs=>xs.map(x=>({id:x.dataset.splitSessionId,selected:x.querySelectorAll('[data-selected="true"]').length})));report.checks.push({name:'workspace-focused-pane-shortcuts',focusedIndex:1,selected});await page.keyboard.press('Escape')
 await memory('workspace-visible')
 for(const cpu of [1,4]){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});await page.waitForTimeout(400)
  for(let i=0;i<6;i++){
   await measure('workspace-to-home',cpu,()=>page.getByRole('button',{name:'新建会话',exact:true}).click())
   await measure('home-to-workspace',cpu,()=>tab('__terminal-workspace__').click())
   await page.waitForTimeout(500)
  }
  console.log(`完成 CPU ${cpu}x：合并工作空间切换 12 个窗口`)
 }
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await memory('workspace-after-24-switches')
 await tab('__terminal-workspace__').hover();await tab('__terminal-workspace__').getByRole('button',{name:'关闭标签页',exact:true}).click();await page.waitForTimeout(1000);await memory('all-closed')
}catch(e){report.fatal=e.message;await page.screenshot({path:`${dir}/perf-fatal.png`}).catch(()=>{});console.log(`FATAL ${e.message.slice(0,200)}`)}finally{save();await context.storageState({path:authFile});fs.chmodSync(authFile,0o600);await browser.close();console.log(JSON.stringify({actions:report.actions.length,fatal:!!report.fatal}))}

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
