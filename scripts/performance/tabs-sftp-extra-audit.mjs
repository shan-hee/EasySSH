import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/easyssh-browser-check/node_modules/playwright/index.mjs'))
const dir=process.env.AUDIT_OUTPUT_DIR||'/tmp/easyssh-tabs-audit',origin=process.env.PERF_ORIGIN||'http://localhost:5200'
const authFile=process.env.PERF_AUTH_STATE||`${dir}/auth-state.json`
const state=JSON.parse(fs.readFileSync(authFile,'utf8'));state.origins=state.origins.map(x=>({...x,origin}))
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',args:['--no-sandbox']})
const context=await browser.newContext({storageState:state,viewport:{width:1440,height:900},acceptDownloads:true})
const page=await context.newPage();page.setDefaultTimeout(15000)
const report={checks:[],errors:[],createdAt:new Date().toISOString()};let serverId,headers={},scratchCreated=false
const scratch=`easyssh-tabs-audit-${randomUUID()}`,scratchPath=`/tmp/${scratch}`
page.on('request',async r=>{const u=new URL(r.url());if(/\/sftp\/[^/]+\/list$/.test(u.pathname))serverId=u.pathname.split('/').at(-2);if(u.pathname.includes('/sftp/')){const h=await r.allHeaders();for(const key of ['authorization','x-csrf-token'])if(h[key])headers[key]=h[key]}})
page.on('pageerror',e=>report.errors.push(e.message))
const save=()=>fs.writeFileSync(`${dir}/extra-functional.json`,JSON.stringify(report,null,2))
const check=async(name,fn)=>{try{report.checks.push({name,passed:true,detail:await fn()});console.log(`PASS ${name}`)}catch(e){report.checks.push({name,passed:false,error:e.message.slice(0,1200)});console.log(`FAIL ${name}: ${e.message.slice(0,180)}`)}save()}
const picker=()=>page.getByRole('button',{name:'选择服务器并打开 SFTP',exact:true})
const panel=()=>page.locator('[data-extra-session-id]:visible')
const navigate=async p=>{await panel().locator('div[data-sftp-glass-control="path"]').click();const input=panel().locator('input[data-sftp-glass-control="path"]');await input.fill(p);const response=page.waitForResponse(r=>/\/sftp\/[^/]+\/list$/.test(new URL(r.url()).pathname)&&new URL(r.url()).searchParams.get('path')===p,{timeout:30000});await input.press('Enter');assert.equal((await response).status(),200);await page.waitForTimeout(200)}
const addSftp=async()=>{await picker().click();await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({hasText:process.env.AUDIT_SERVER||'PVE-Debian 13'}).click();await panel().locator('[data-sftp-file-item]').first().waitFor({timeout:30000})}
try{
 await page.goto(`${origin}/dashboard/terminal`);await picker().waitFor({timeout:45000})
 if (process.env.AUDIT_FILES_ONLY !== '1') {
 await check('SFTP 选择弹窗支持搜索及取消且不创建空页签',async()=>{await picker().click();await page.locator('input[cmdk-input]').fill('PVE-Debian');await page.locator('#sftp-start-directory').selectOption('custom');await page.getByRole('option').filter({hasText:'PVE-Debian 13'}).waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(300);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('[data-session-tab-id]').count(),0)})
 if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
 await page.route('**/api/v1/servers?**',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'audit_injected_failure'})}))
 await check('弹窗明确显示加载失败和重试（注入服务器列表 500）',async()=>{await picker().click();await page.getByText('服务器列表加载失败',{exact:true}).waitFor({timeout:30000});report.pickerFailureText=await page.getByRole('dialog').innerText();assert.match(report.pickerFailureText,/失败|重试|错误/)})
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.unrouteAll({behavior:'wait'})
 await addSftp()
 await check('SFTP 390px 窄屏无整页横向溢出',async()=>{await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('main').screenshot({path:`${dir}/mobile-main.png`})})
 await page.setViewportSize({width:1440,height:900})
 await check('独立 SFTP 页签可固定，固定后不能中键关闭',async()=>{const t=page.locator('[data-session-tab-id]');await t.dblclick();assert.equal(await t.getByRole('button',{name:'关闭标签页',exact:true}).count(),0);await t.dblclick()})
 await check('路径直接输入、大目录虚拟列表和搜索',async()=>{let entries=0;const response=page.waitForResponse(r=>new URL(r.url()).searchParams.get('path')==='/usr/bin'&&r.url().includes('/list'));await navigate('/usr/bin');const json=await(await response).json();entries=(json.data??json).files.length;await panel().locator('[data-sftp-file-item]').first().waitFor();const rendered=await panel().locator('[data-sftp-file-item]').count();assert.ok(entries>100);assert.ok(rendered<entries);await panel().getByPlaceholder('搜索文件...').fill('bash');await page.waitForTimeout(200);assert.ok(await panel().getByText('bash',{exact:true}).isVisible());await panel().getByPlaceholder('搜索文件...').fill('');return{entries,rendered}})
 await check('快速导航以最后一次输入为准（延迟真实 /usr 响应）',async()=>{
  await page.route('**/sftp/*/list?**',async route=>{if(new URL(route.request().url()).searchParams.get('path')!=='/usr')return route.continue();const response=await route.fetch();await new Promise(r=>setTimeout(r,1800));await route.fulfill({response})})
  const setPath=async p=>{await panel().locator('div[data-sftp-glass-control="path"]').click();const input=panel().locator('input[data-sftp-glass-control="path"]');await input.fill(p);await input.press('Enter')}
  await setPath('/usr');await page.waitForTimeout(150);await setPath('/etc');await page.waitForTimeout(2500)
  const value=await panel().locator('div[data-sftp-glass-control="path"]').innerText();report.navigationRacePath=value;assert.equal(value.replace(/\s/g,''),'/etc')
 })
 await page.unrouteAll({behavior:'wait'})
 } else { await addSftp() }
 await navigate('/tmp')
 await check('SFTP 新建独立临时目录',async()=>{await panel().getByRole('columnheader').first().click({button:'right'});await page.getByRole('menuitem',{name:/新建文件夹/}).click();const input=panel().locator('[data-sftp-browser] input:not([type=file])');await input.fill(scratch);const response=page.waitForResponse(r=>r.url().endsWith('/mkdir'));await input.press('Enter');assert.equal((await response).status(),200);scratchCreated=true;report.remoteScratchPath=scratchPath;save();await navigate(scratchPath)})
 if(scratchCreated){
  const payload=Buffer.from('EasySSH SFTP audit\n中文读写验证\n','utf8')
  await check('SFTP 上传 UTF-8 文件并显示在列表中',async()=>{await panel().locator('input[type=file]').first().setInputFiles({name:'audit.txt',mimeType:'text/plain',buffer:payload});await panel().getByText('audit.txt',{exact:true}).waitFor({timeout:30000})})
  await check('SFTP 重命名文件',async()=>{await panel().getByText('audit.txt',{exact:true}).click();await page.keyboard.press('F2');const input=panel().locator('[data-sftp-file-item] input');await input.fill('renamed.txt');await input.press('Enter');await panel().getByText('renamed.txt',{exact:true}).waitFor()})
  await check('SFTP 下载结果与上传字节完全一致',async()=>{await panel().getByText('renamed.txt',{exact:true}).click({button:'right'});const downloaded=page.waitForEvent('download',{timeout:30000});await page.getByRole('menuitem',{name:/^下载/}).first().click();const dl=await downloaded;const file=await dl.path();assert.deepEqual(fs.readFileSync(file),payload);return{bytes:payload.length}})
  await check('SFTP 打开文本文件编辑器',async()=>{await panel().getByText('renamed.txt',{exact:true}).dblclick();await panel().locator('.monaco-editor').waitFor({timeout:30000});await page.waitForFunction(()=>[...document.querySelectorAll('.monaco-editor .view-lines')].some(x=>x.innerText.replace(/\u00a0/g,' ').includes('EasySSH SFTP audit')),{timeout:15000})})
  await check('SFTP 编辑保存后远端文件内容更新',async()=>{await panel().locator('.monaco-editor .view-lines').click({position:{x:80,y:10}});await page.keyboard.press('Control+Home');if(process.env.AUDIT_TYPING_DELAY){await page.keyboard.type('Updated audit',{delay:Number(process.env.AUDIT_TYPING_DELAY)});report.beforeEnter = await panel().locator('.monaco-editor').evaluate(el=>({suggestionVisible:!!el.querySelector('.suggest-widget.visible'),textareaValue:el.querySelector('textarea')?.value}));await page.keyboard.press('Enter')}else{await page.keyboard.insertText('Updated audit\n')}await page.waitForTimeout(300);report.editorInput=await panel().locator('.monaco-editor').evaluate(el=>({activeTag:document.activeElement?.tagName,activeRole:document.activeElement?.getAttribute('role'),hasTypedText:el.innerText.includes('Updated audit')}));save();const saveButton=panel().getByRole('button',{name:'保存',exact:true});await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-label="保存"]')].some(x=>!x.disabled));const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/write')),saveButton.click()]);assert.equal(response.status(),200);const r=await context.request.get(`${origin}/api/v1/sftp/${serverId}/read?path=${encodeURIComponent(scratchPath+'/renamed.txt')}`,{headers});assert.equal(r.status(),200);assert.equal(await r.text(),'Updated audit\n'+payload.toString())})

 }
}catch(e){report.fatal=e.message;report.fatalPath=new URL(page.url()).pathname;await page.screenshot({path:`${dir}/extra-fatal.png`});console.log(`FATAL ${e.message.slice(0,250)}`)}
finally{
 if(scratchCreated&&serverId){try{const r=await context.request.post(`${origin}/api/v1/sftp/${serverId}/delete-paths`,{headers,data:{paths:[scratchPath]}});report.cleanup={status:r.status(),success:r.ok()};if(r.ok()){const verification=await context.request.get(`${origin}/api/v1/sftp/${serverId}/list?path=%2Ftmp`,{headers});const json=await verification.json();report.cleanup.verifiedAbsent=verification.ok()&&!(json.data??json).files.some(file=>file.name===scratch);}if(!r.ok())report.cleanup.remainingPath=scratchPath;console.log(`临时目录清理 ${r.status()}`)}catch(e){report.cleanup={success:false,remainingPath:scratchPath,error:e.message}}}
 save();await context.storageState({path:authFile});fs.chmodSync(authFile,0o600);await browser.close();console.log(JSON.stringify({checks:report.checks.length,passed:report.checks.filter(x=>x.passed).length,failed:report.checks.filter(x=>!x.passed).length,fatal:!!report.fatal}))
}

// A recorded failure must also fail the command, after reports and cleanup are saved.
const cleanupResults = Array.isArray(report.cleanup) ? report.cleanup : report.cleanup ? [report.cleanup] : []
if (report.fatal || report.checks.some(check => !check.passed) || cleanupResults.some(result => result.success === false || result.verifiedAbsent === false)) process.exitCode = 1
