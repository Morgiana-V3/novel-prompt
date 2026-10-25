// Two real stdio clients -> authenticated local bridge -> real task/workspace services -> built Vue UI.
// All provider traffic is intercepted; profiles, images and screenshots are isolated.
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const ts = require('typescript'), { PNG } = require('pngjs')
const root = join(__dirname, '..'), profile = mkdtempSync(join(tmpdir(), 'np-desktop-mcp-'))
app.setPath('userData', profile); app.getAppPath = () => root; app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'np-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(readFileSync(f,'utf8'), { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true} }).outputText,f)
const settings = require('../src/main/settings.ts'), pages = require('../src/main/page-workspaces.ts'), client = require('../src/main/nai/client.ts')
const { tagStore } = require('../src/main/tagdb/store.ts')
settings.saveSettings({ apiKey:'offline-fixture', naiToken:'fixture', mcpAllowAi:true, mcpAllowGenerate:true, naiVersion:'v5' })
tagStore.status = () => ({ loaded:true, tagCount:330000, aliasCount:1000, zhCount:10000, implicationCount:1000 })
let pendingGeneration = [], autoGenerate = false, holdAi = false, aiStarted = 0, freeTier = true
const generationInputs = []
net.fetch = async (url, init) => {
  if(url.endsWith('/user/subscription')) return Response.json({active:true,tier:freeTier?3:1,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0},usage:{percent:80,isNegative:false}})
  if(url.endsWith('/chat/completions')) {
    aiStarted++
    if(holdAi) await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('fixture cancelled')),{once:true}))
    const input=JSON.parse(JSON.parse(init.body).messages[1].content[0].text)
    const proposal={title:'前台 AI 修改建议',warning:'',draft:{...input.draft,base:input.draft.base+', blue sky'},execution:{kind:'generate',regionId:null}}
    return Response.json({choices:[{message:{content:JSON.stringify({reply:'已按当前输入提出修改，请检查并采纳。',understanding:null,proposal})}}]})
  }
  assert.equal(url,'https://image.novelai.net/ai/generate-image')
  generationInputs.push(JSON.parse(init.body))
  if(!autoGenerate) await new Promise(resolve => pendingGeneration.push(resolve))
  const params = JSON.parse(init.body).parameters
  const png = new PNG({width:params.width,height:params.height}); png.data.fill(generationInputs.length%2?255:100)
  for(let i=3;i<png.data.length;i+=4)png.data[i]=255
  return new Response(PNG.sync.write(png),{headers:{'content-type':'image/png'}})
}
const pause = ms => new Promise(r=>setTimeout(r,ms))
const wait = async predicate => { for(let i=0;i<300;i++){if(await predicate())return;await pause(25)}throw Error('Timed out: '+predicate) }
let win, bridge, desktop
const send = (channel,payload) => { if(win&&!win.isDestroyed())win.webContents.send(channel,payload);bridge?.changed() }
const { registerTaskIpc } = require('../src/main/task-ipc.ts')
const tasks = registerTaskIpc(send)
for(const [name,handler] of Object.entries({
  'settings:get':()=>settings.getSettings(), 'settings:save':(_,p)=>settings.saveSettings(p), 'db:status':()=>tagStore.status(),
  'window:dark-titlebar':()=>{}, 'skills:list':()=>[], 'mcp:info':()=>null,'update:check':()=>null,'update:state':()=>null,
  'nai:list':()=>client.listImages(), 'nai:freeCheck':()=>({ok:true,reasons:[],notes:[]}),
  'nai:readImage':(_,name)=>new Uint8Array(readFileSync(client.imagePath(name))),
  'pages:list':()=>pages.listPages(), 'pages:read':(_,id)=>pages.readPage(id), 'pages:edit':(_,id,rev,action)=>pages.editPage(id,rev,action),
  'pages:create':(_,image,params,model,draft)=>pages.createPage(image,params,model,draft),
  'prompt:analyze':()=>({tokens:[],stats:{total:0,valid:0,alias:0,unknown:0,natural:0,text:0}})
}))ipcMain.handle(name,handler)
const clients=[]
function connectAgent() {
  const child = spawn(process.execPath,[join(root,'scripts/mcp-proxy.cjs'),root],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NOVELPROMPT_USER_DATA:profile},stdio:['pipe','pipe','pipe']})
  let next=1, stderr=''; const waiting=new Map(), events=[]
  child.stderr.on('data',b=>stderr+=b)
  createInterface({input:child.stdout}).on('line',line=>{
    const msg=JSON.parse(line)
    if(msg.id===undefined)events.push(msg)
    else { const item=waiting.get(msg.id);if(item){clearTimeout(item.timer);waiting.delete(msg.id);item.resolve(msg)} }
  })
  child.on('exit',code=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('Agent exited '+code+': '+stderr))}waiting.clear()})
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const id=next++,timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timeout '+stderr))},20000)
    waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')
  })
  const agent={child,events,request,async tool(name,args={},meta){const r=await request('tools/call',{name,arguments:args,...(meta?{_meta:meta}:{})});if(r.error||r.result?.isError)throw Error(r.error?.message||r.result.content[0].text);return r.result},async data(name,args={}){const r=await this.tool(name,args);return r.structuredContent??JSON.parse(r.content[0].text)}}
  clients.push(agent);return agent
}
app.whenReady().then(async()=>{
  try{
    const { DesktopBridge }=require('../src/main/desktop.ts')
    const { startMcpBridge }=require('../src/main/mcp/bridge.ts')
    const { desktopTools }=require('../src/main/mcp/desktop-tools.ts')
    const { frontendTools }=require('../src/main/mcp/frontend-tools.ts')
    const { agentExecutor }=require('../src/main/mcp/runtime.ts')
    const { buildTools,MCP_INSTRUCTIONS }=require('../src/main/mcp/tools.ts')
    win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{preload:join(root,'out/preload/index.js'),sandbox:false,offscreen:true,backgroundThrottling:false}})
    desktop=new DesktopBridge(()=>win,()=>{});desktop.onChange=()=>bridge?.changed()
    const state=()=>({hostPid:process.pid,visible:false,desktop:desktop.state,tasks:tasks.snapshot()})
    bridge=await startMcpBridge(root,profile,[...buildTools(),...desktopTools(desktop,tasks,state),...frontendTools(desktop)],{name:'novel-prompt',version:'0.5.0',instructions:MCP_INSTRUCTIONS},{state,execute:agentExecutor(tasks,desktop,send)})
    protocol.handle('np-img',req=>new Response(readFileSync(client.imagePath(decodeURIComponent(new URL(req.url).pathname.slice(1))))))
    await win.loadFile(join(root,'out/renderer/index.html'))
    const js=code=>win.webContents.executeJavaScript(code,true)
    const ui=predicate=>wait(()=>js(predicate))
    const click=async(selector,text)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click()})()`);await pause(50)}
    await wait(()=>desktop.state?.model==='v5')
    const a=connectAgent(),b=connectAgent()
    for(const c of [a,b])await c.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture-agent',version:'1'}})
    assert.equal((await a.data('get_app_state')).hostPid,(await b.data('get_app_state')).hostPid)
    assert.equal((await a.request('tools/list')).result.tools.length,51)
    await assert.rejects(a.tool('ui_capture_app'),/隐藏|最小化/)
    await assert.rejects(a.tool('ui_capture_app',{max_edge:99999}),/512/)
    assert.equal((await a.request('initialize',null)).error.code,-32600)
    assert.equal((await b.request('ping')).result.constructor,Object)
    const beforeInvalid=(await a.data('list_workspaces')).items.length
    await assert.rejects(a.tool('create_workspace',{draft:{base:'1girl',negative:'',characters:[]},title:'x'.repeat(6001),show:false}),/标题/)
    assert.equal((await a.data('list_workspaces')).items.length,beforeInvalid)
    await a.request('resources/subscribe',{uri:'novelprompt://app/state'})
    let s=await a.data('get_app_state')
    await js(`(()=>{const e=document.querySelector('.compare textarea');e.value='1girl, glasses';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(()=>a.events.some(e=>e.method==='notifications/resources/updated'))
    await assert.rejects(b.tool('apply_app_prompt',{expected_token:s.desktop.token,draft:{base:'stale',negative:'',characters:[]}}),/已变化/)
    s=await b.data('get_app_state')
    await b.tool('apply_app_prompt',{expected_token:s.desktop.token,draft:{base:'1girl, outdoors',negative:'blurry',characters:[]}})
    await ui(`document.querySelector('.compare textarea').value==='1girl, outdoors'`)
    assert.ok(await js(`JSON.parse(localStorage.getItem('np-workspace-v1')).history.some(h=>h.base==='1girl, glasses')`))
    await a.tool('navigate_app',{tab:'ai'});await ui(`document.querySelector('.nav-item.active').textContent.includes('AI 优化')`)
    await js(`(()=>{const el=document.createElement('div');el.id='capture-private-fixture';el.dataset.mcpPrivate='';el.textContent='PRIVATE_FIXTURE';el.style.cssText='position:fixed;left:250px;top:10px;width:100px;height:40px;z-index:2147483647;background:rgb(250,0,250);color:white';document.body.append(el)})()`)
    await pause(150)
    const magenta=buffer=>{const p=PNG.sync.read(buffer);let n=0;for(let i=0;i<p.data.length;i+=4)if(p.data[i]===250&&p.data[i+1]===0&&p.data[i+2]===250)n++;return n}
    assert.ok(magenta((await win.webContents.capturePage()).toPNG())>100,'sensitive fixture is actually visible before capture')
    const screenshot=await a.tool('ui_capture_app',{max_edge:1024})
    const screenshotImage=screenshot.content.find(c=>c.type==='image')
    assert.equal(screenshotImage.mimeType,'image/png');assert.equal(magenta(Buffer.from(screenshotImage.data,'base64')),0,'private region never appears in returned pixels')
    assert.ok(Math.max(screenshot.structuredContent.displayed.width,screenshot.structuredContent.displayed.height)<=1024)
    assert.equal(screenshot.structuredContent.desktop.tab,'ai');assert.equal(screenshot.structuredContent.redactedFields,1)
    assert.equal(await js(`getComputedStyle(document.getElementById('capture-private-fixture')).visibility`),'visible')
    assert.equal(await js(`!!document.getElementById('np-mcp-capture-privacy')`),false)
    await js(`document.getElementById('capture-private-fixture').remove()`)
    await a.tool('navigate_app',{tab:'settings'})
    const settingsShot=await a.tool('ui_capture_app')
    assert.equal(settingsShot.structuredContent.redactedFields,2)
    await a.tool('navigate_app',{tab:'ai'})
    console.log('PASS real application screenshot, bounded dimensions, hidden-window refusal and credential redaction with UI restored')
    console.log('PASS two real stdio agents share a host; live state/subscriptions, tab navigation, visible prompt writes, stale-token rejection and undo history')

    const generation=a.tool('generate_image',{base:'1girl',width:64,height:64,confirm:true},{progressToken:'generation-1'})
    await wait(()=>pendingGeneration.length===1)
    await assert.rejects(b.tool('generate_image',{base:'1girl',confirm:true}),/仍在运行/)
    const denied=await js(`window.api.naiGenerate({}).then(()=>'',e=>String(e))`);assert.match(denied,/仍在运行/)
    const active=(await b.data('list_tasks')).tasks.find(t=>t.kind==='generate'&&t.status==='running')
    assert.equal(active.origin,'agent')
    await js(`document.querySelector('.task-trigger').click()`)
    await ui(`document.querySelector('.task-panel').textContent.includes('Agent · NovelAI 生图')`)
    await b.tool('cancel_task',{id:active.id});pendingGeneration.shift()()
    const generated=JSON.parse((await generation).content[0].text)
    assert.match(generated.stopped,/已停止/);assert.equal(generated.images.length,1)
    assert.ok(a.events.some(e=>e.method==='notifications/progress'&&e.params.progressToken==='generation-1'))
    const picture=await b.tool('read_image',{name:generated.images[0].name});assert.ok(picture.content.some(c=>c.type==='image'))
    await js(`document.querySelector('.task-trigger').click()`)
    console.log('PASS MCP/UI generation exclusion, real progress, shared cancellation, saved results and direct MCP image content')

    let w=await a.data('create_workspace',{title:'Agent 联动测试',draft:{base:'1girl, green eyes',negative:'blurry',characters:[]}})
    await ui(`document.querySelector('.pw-heading').textContent.includes('Agent 联动测试')`)
    w=await b.data('get_workspace',{id:w.id})
    const oldRevision=w.revision
    w=await a.data('propose_workspace_edit',{id:w.id,revision:w.revision,title:'仅修改眼睛颜色',explanation:'外部 Agent 提交的修改，等待采纳。',draft:{base:'1girl, blue eyes',negative:'blurry',characters:[]}})
    await ui(`document.querySelector('.pw-shell').textContent.includes('仅修改眼睛颜色')`)
    const proposal=w.messages.at(-1)
    assert.equal(proposal.proposal.status,'pending')
    assert.equal(proposal.proposal.contextKey,undefined,'internal context including masks is not sent to agents')
    await assert.rejects(b.tool('apply_workspace_action',{id:w.id,revision:oldRevision,action:{type:'proposal',messageId:proposal.id,decision:'accept'}}),/更新/)
    w=await b.data('get_workspace',{id:w.id})
    w=await b.data('apply_workspace_action',{id:w.id,revision:w.revision,action:{type:'proposal',messageId:proposal.id,decision:'accept'}})
    assert.equal(w.versions.find(v=>v.id===w.currentVersionId).editor.draft.base,'1girl, blue eyes')
    await click('.pw-view-tabs button','当前提示词');await click('.pw-prompt-actions button','编辑')
    await assert.rejects(a.tool('propose_workspace_edit',{id:w.id,revision:w.revision,title:'冲突修改',draft:{base:'wrong',negative:'',characters:[]}}),/正在编辑/)
    await ui(`document.querySelector('.pw-prompt-actions').textContent.includes('保存草稿')`)
    await click('.pw-prompt-actions button','取消编辑')
    await js(`(()=>{const e=document.querySelector('.pw-compose textarea');e.value='用户还没发送的新想法';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    w=await b.data('get_workspace',{id:w.id});assert.equal(w.composer,'用户还没发送的新想法')
    autoGenerate=true
    const produced=await b.data('generate_workspace',{id:w.id,revision:w.revision,confirm:true})
    assert.equal(produced.workspace.versions.length,2)
    await ui(`document.querySelector('.pw-header').textContent.includes('历史 2')`)
    await b.tool('navigate_app',{tab:'workspace',workspace_id:w.id})
    await pause(250);writeFileSync(join(profile,'desktop-agent-workspace.png'),(await win.webContents.capturePage()).toPNG())
    win.setSize(1100,760);await pause(250);writeFileSync(join(profile,'desktop-agent-compact.png'),(await win.webContents.capturePage()).toPNG())
    console.log('PASS workspace create/open, live proposal/review/adoption, revision conflicts, active-editor guard, composer preservation and generation history')
    win.setSize(1440,960)
    const stages=[]; desktop.onChange=()=>{bridge?.changed();if(desktop.state?.frontend)stages.push(structuredClone(desktop.state))}
    let front=await a.data('ui_open_workspace',{id:w.id})
    assert.equal(front.workspace.id,w.id)
    front=await a.data('ui_create_workspace',{title:'可视化前台验收',source:'current'})
    const frontId=front.workspace.id, firstVersion=front.workspace.versionId
    const act=async(name,args={})=>{
      const latest=(await a.data('get_app_state')).desktop
      return a.data(name,{id:frontId,expected_token:latest.token,...args})
    }
    assert.equal(pages.readPage(frontId).title,'可视化前台验收')
    assert.ok(stages.some(s=>s.frontend.stage==='已填写新建会话表单'&&s.blockers.includes('正在新建工作台会话')))
    const stale=front.token
    await js(`(()=>{const e=document.querySelector('.pw-compose textarea');e.value='保留我的输入';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await assert.rejects(a.tool('ui_set_workspace_input',{id:frontId,expected_token:stale,text:'错误覆盖'}),/已变化/)
    await ui(`document.querySelector('.pw-compose textarea').value==='保留我的输入'`)
    front=await act('ui_set_workspace_input',{text:'把天空改成蓝色'})
    assert.equal(front.workspace.composer,'把天空改成蓝色');assert.equal(aiStarted,0)
    settings.saveSettings({mcpAllowAi:false})
    await assert.rejects(act('ui_send_workspace_message'),/允许|权限/)
    settings.saveSettings({mcpAllowAi:true})
    holdAi=true
    const chatting=act('ui_send_workspace_message').then(()=>null,e=>e)
    await wait(()=>aiStarted===1)
    const during=(await b.data('get_app_state')).desktop
    assert.equal(during.frontend.status,'running')
    const busyShot=await b.tool('ui_capture_app')
    assert.equal(busyShot.structuredContent.desktop.frontend.status,'running','capture is not blocked behind AI command queue')
    assert.equal(busyShot.structuredContent.desktop.workspace.id,frontId)
    await ui(`document.querySelector('.pw-shell').textContent.includes('把天空改成蓝色')`)
    await assert.rejects(b.tool('ui_view_workspace',{id:frontId,expected_token:during.token,pane:'prompt'}),/前台操作/)
    await assert.rejects(b.tool('propose_workspace_edit',{id:frontId,revision:pages.readPage(frontId).revision,title:'并发覆盖',draft:{base:'wrong',negative:'',characters:[]}}),/前台操作/)
    await js('window.api.cancelFrontend()')
    assert.match(String(await chatting),/取消|停止|cancel/)
    assert.ok(tasks.snapshot().tasks.some(t=>t.kind==='page-chat'&&t.origin==='agent'&&t.status==='cancelled'))
    holdAi=false
    await act('ui_set_workspace_input',{text:'把天空改成蓝色'})
    front=await act('ui_send_workspace_message')
    assert.equal(front.workspace.pane,'suggestions');assert.equal(front.workspace.latestProposal.status,'pending')
    const messageId=front.workspace.latestProposal.id
    for(const decision of ['accept','undo']) {
      front=await act('ui_review_workspace',{message_id:messageId,decision})
      assert.equal(front.workspace.latestProposal.status,{accept:'accepted',undo:'withdrawn',reject:'rejected'}[decision])
    }
    await act('ui_set_workspace_input',{text:'重新给出蓝色天空方案'})
    front=await act('ui_send_workspace_message')
    front=await act('ui_review_workspace',{message_id:front.workspace.latestProposal.id,decision:'accept'})
    await act('ui_view_workspace',{pane:'prompt'})
    await ui(`document.querySelector('.pw-shell').textContent.includes('blue sky')`)
    settings.saveSettings({mcpAllowGenerate:false})
    await assert.rejects(act('ui_generate_workspace',{kind:'generate',confirm:true}),/允许|权限/)
    settings.saveSettings({mcpAllowGenerate:true})
    const countBeforeDenied=generationInputs.length
    freeTier=false;settings.saveSettings({naiFreeOnly:false})
    await assert.rejects(act('ui_generate_workspace',{kind:'generate',confirm:true}),/免费/)
    assert.equal(generationInputs.length,countBeforeDenied,'foreground forces free check even with manual paid setting')
    freeTier=true;settings.saveSettings({naiFreeOnly:true})
    front=await act('ui_generate_workspace',{kind:'generate',confirm:true})
    assert.notEqual(front.workspace.versionId,firstVersion);assert.equal(front.workspace.historyOpen,true)
    const generatedVersion=front.workspace.versionId
    const beforeRegion=pages.readPage(frontId).versions.find(v=>v.id===generatedVersion)
    const originalPng=PNG.sync.read(readFileSync(client.imagePath(beforeRegion.image.name)))
    const regionPromise=act('ui_add_workspace_region',{rectangles:[{x:20,y:30,width:40,height:50}],instruction:'仅修改这里的颜色'})
    await wait(()=>desktop.state?.frontend?.stage==='已填写区域批注')
    await ui(`!!document.querySelector('.ip-dialog')&&document.querySelector('.ip-dialog').textContent.includes('区域')`)
    const editorShot=await b.tool('ui_capture_app')
    assert.equal(editorShot.structuredContent.desktop.workspace.editing,true)
    assert.ok(editorShot.content.some(c=>c.type==='image'))
    writeFileSync(join(profile,'frontend-region.png'),(await win.webContents.capturePage()).toPNG())
    front=await regionPromise
    assert.equal(front.workspace.regions.length,1);assert.equal(front.workspace.regions[0].instruction,'仅修改这里的颜色')
    assert.equal(await js('!!document.querySelector(".ip-dialog")'),false)
    const regionId=front.workspace.regionId
    const savedRegion=pages.readPage(frontId).versions.find(v=>v.id===generatedVersion).editor.regions[0]
    const savedMask=PNG.sync.read(Buffer.from(savedRegion.mask,'base64'))
    assert.equal([...savedMask.data].filter((x,i)=>i%4===0&&x>0).length,40*50)
    front=await act('ui_add_workspace_region',{rectangles:[{x:80,y:90,width:20,height:20}],instruction:'第二个区域'})
    assert.equal(front.workspace.regions.length,2)
    front=await act('ui_generate_workspace',{kind:'inpaint',region_id:regionId,confirm:true})
    assert.equal(generationInputs.at(-1).action,'infill')
    const resultPage=pages.readPage(frontId), resultVersion=resultPage.versions.find(v=>v.id===resultPage.currentVersionId)
    const outputPng=PNG.sync.read(readFileSync(client.imagePath(resultVersion.image.name)))
    let changed=0
    for(let i=0;i<originalPng.data.length;i+=4) {
      if(!savedMask.data[i])assert.ok(originalPng.data.subarray(i,i+4).equals(outputPng.data.subarray(i,i+4)))
      else if(!originalPng.data.subarray(i,i+4).equals(outputPng.data.subarray(i,i+4)))changed++
    }
    assert.ok(changed>0)
    front=await act('ui_view_workspace',{pane:'history',version_id:firstVersion})
    assert.equal(front.workspace.viewedVersionId,firstVersion);assert.notEqual(front.workspace.versionId,firstVersion)
    front=await act('ui_review_workspace',{decision:'switch',version_id:generatedVersion})
    assert.equal(front.workspace.versionId,generatedVersion)
    await act('ui_view_workspace',{pane:'changes'})
    writeFileSync(join(profile,'frontend-complete.png'),(await win.webContents.capturePage()).toPNG())
    await act('ui_set_workspace_input',{text:'再给一个建议，先不采用'})
    front=await act('ui_send_workspace_message')
    front=await act('ui_review_workspace',{decision:'reject',message_id:front.workspace.latestProposal.id})
    assert.equal(front.workspace.latestProposal.status,'rejected')
    autoGenerate=false
    const countBeforeCancel=pages.readPage(frontId).versions.length
    const stoppedGeneration=act('ui_generate_workspace',{kind:'generate',confirm:true}).then(()=>null,e=>e)
    await wait(()=>pendingGeneration.length===1)
    await js('window.api.cancelFrontend()')
    assert.equal((await b.data('get_app_state')).desktop.frontend.status,'running','current image must finish saving before UI unlocks')
    pendingGeneration.shift()()
    assert.match(String(await stoppedGeneration),/停止/)
    assert.equal(pages.readPage(frontId).versions.length,countBeforeCancel+1,'cancelled foreground generation preserves completed image')
    assert.ok(stages.some(s=>s.frontend.stage==='已在原图上绘制遮罩'))
    console.log('PASS all 8 foreground MCP tools through real Vue handlers: visible form/input/chat/review/editor/masks/generation/history, permissions, stale state, cancellation, concurrency and unchanged pixels outside mask')
    // External takeover uses the real MCP connection identity and renderer flow;
    // disabling the model key makes any accidental internal AI call fail the test.
    const aiBeforeExternal=aiStarted
    await act('ui_review_workspace',{decision:'switch',version_id:generatedVersion})
    settings.saveSettings({apiKey:'',mcpAllowAi:false})
    front=await act('ui_set_workspace_agent',{mode:'external'})
    assert.equal(front.workspace.agentMode,'external');assert.equal(front.workspace.agentConnected,true)
    await assert.rejects(b.data('set_workspace_agent',{id:frontId,revision:pages.readPage(frontId).revision,mode:'external'}),/另一个在线/)
    await assert.rejects(b.data('set_workspace_agent',{id:frontId,revision:pages.readPage(frontId).revision,mode:'internal'}),/另一个在线/)
    await act('ui_set_workspace_input',{text:'外部 Agent 帮我检查当前区域，先讨论',region_id:regionId})
    front=await act('ui_send_workspace_message')
    assert.ok(front.workspace.pendingRequestId)
    const tokenBeforeRead=(await a.data('get_app_state')).desktop.token
    await a.data('get_workspace',{id:frontId})
    assert.equal((await a.data('get_app_state')).desktop.token,tokenBeforeRead,'read-only synchronization does not invalidate frontend tokens')
    let context=await a.data('get_workspace_context',{id:frontId})
    assert.ok(context.preview.preview_path);assert.ok(context.skills.text);assert.equal(context.capabilities.strength.max,1)
    const frozenSkills=context.skills.digest
    await assert.rejects(require('../src/main/ai/page-collaborator.ts').discussPage(frontId,context.revision,'绕过接管',null,[]),/外部 Agent/)
    const pureReply={requestId:context.request.id,reply:'外部 Agent 已读取选区。这是纯讨论，未生成图片。'}
    await assert.rejects(b.data('reply_workspace_request',{id:frontId,revision:context.revision,response:pureReply}),/未接管/)
    front=await act('ui_reply_workspace_request',{response:pureReply})
    assert.equal(front.workspace.pendingRequestId,null)
    assert.equal(pages.readPage(frontId).messages.at(-1).author.name,'fixture-agent')
    await assert.rejects(act('ui_reply_workspace_request',{response:pureReply}),/已完成/)
    await act('ui_set_workspace_input',{text:'外部方案：调整选区，保留画面其余部分',region_id:regionId})
    await act('ui_send_workspace_message');context=await a.data('get_workspace_context',{id:frontId})
    assert.equal(context.skills.digest,frozenSkills)
    const externalDraft={...context.draft,base:context.draft.base+', soft light'}
    const extResponse={requestId:context.request.id,reply:'已提出选区修改建议，尚未执行。',proposal:{title:'外部区域方案',warning:'仅选区内允许变化。',draft:externalDraft,execution:{kind:'inpaint',regionId}}}
    front=await act('ui_reply_workspace_request',{response:extResponse})
    const externalProposalId=front.workspace.latestProposal.id
    assert.equal(front.workspace.pane,'suggestions')
    const stored=pages.readPage(frontId).messages.find(m=>m.id===externalProposalId)
    assert.equal(stored.proposal.regionId,regionId);assert.equal(stored.proposal.status,'pending')
    front=await act('ui_review_workspace',{message_id:externalProposalId,decision:'accept'})
    assert.equal(pages.readPage(frontId).execution.kind,'inpaint')
    front=await act('ui_review_workspace',{message_id:externalProposalId,decision:'undo'})
    await act('ui_set_workspace_input',{text:'再次讨论，不生成',region_id:regionId});await act('ui_send_workspace_message')
    context=await a.data('get_workspace_context',{id:frontId})
    await a.data('reply_workspace_request',{id:frontId,revision:context.revision,response:{...extResponse,requestId:context.request.id}})
    const retained=pages.readPage(frontId).messages.find(m=>m.id===externalProposalId).proposal
    assert.ok(retained.superseded);assert.deepEqual(retained.after,externalDraft)
    await act('ui_review_workspace',{message_id:externalProposalId,decision:'undo'}).catch(()=>{})
    await ui(`document.querySelector('.pw-suggestion-board').textContent.includes('外部区域方案')`)
    await act('ui_set_workspace_input',{text:'准备取消的需求'});await act('ui_send_workspace_message')
    context=await a.data('get_workspace_context',{id:frontId})
    await act('ui_cancel_workspace_request')
    await assert.rejects(act('ui_reply_workspace_request',{response:{requestId:context.request.id,reply:'不应写入'}}),/已取消/)
    await act('ui_set_workspace_input',{text:'上下文冲突测试'});await act('ui_send_workspace_message')
    context=await a.data('get_workspace_context',{id:frontId})
    const changedPage=pages.readPage(frontId)
    pages.editPage(frontId,changedPage.revision,{type:'notes',title:changedPage.title,goal:'用户已改变目标',preserve:changedPage.preserve,composer:''})
    await assert.rejects(a.data('reply_workspace_request',{id:frontId,revision:pages.readPage(frontId).revision,response:{requestId:context.request.id,reply:'旧上下文'}}),/需求发出后/)
    await a.data('get_workspace',{id:frontId})
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('已连接')`)
    a.child.stdin.end()
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('连接已断开')`)
    const fresh=(await b.data('get_app_state')).desktop
    await b.data('ui_set_workspace_agent',{id:frontId,expected_token:fresh.token,mode:'external'})
    await b.data('cancel_workspace_request',{id:frontId,revision:pages.readPage(frontId).revision})
    assert.equal(pages.readPage(frontId).agentMode,'external')
    assert.equal(aiStarted,aiBeforeExternal,'external discussion, proposals, cancellation and reconnect never invoke internal AI')
    writeFileSync(join(profile,'external-agent.png'),(await win.webContents.capturePage()).toPNG())
    console.log('PASS external takeover without AI key: live connection ownership, pure replies, region proposals, frozen Skills, full proposal history, cancellation, duplicates, stale context and reconnect; zero internal AI calls')
    console.log('Artifacts:',profile)
    for(const c of clients)c.child.stdin.end()
    await pause(100);bridge.close();app.exit(0)
  }catch(e){console.error(e);if(win&&win.webContents.getURL()){writeFileSync(join(profile,'failure.txt'),await win.webContents.executeJavaScript('document.body.innerText'));writeFileSync(join(profile,'failure.png'),(await win.webContents.capturePage()).toPNG())}for(const c of clients)c.child.kill();bridge?.close();console.error('Artifacts:',profile);app.exit(1)}
})
