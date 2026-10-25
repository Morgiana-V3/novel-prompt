// Offline service + Electron UI regression. All model traffic is intercepted.
// Profiles and screenshots are kept outside the repository.
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const ts = require('typescript'), { PNG } = require('pngjs')
const profile = mkdtempSync(join(tmpdir(), 'np-page-workspace-'))
const artifacts = process.env.NP_TEST_ARTIFACTS || profile
mkdirSync(artifacts, { recursive: true })
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '..')
protocol.registerSchemesAsPrivileged([{ scheme: 'np-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f)
const client = require('../src/main/nai/client.ts')
const pages = require('../src/main/page-workspaces.ts')
const collaborator = require('../src/main/ai/page-collaborator.ts')
const { pageCurrent, pageDraft, pageIteration } = require('../src/shared/page-workspace.ts')
const { renderMarkdown } = require('../src/renderer/src/markdown.ts')
const { isWebUrl } = require('../src/shared/web-url.ts')
const { extractJson } = require('../src/main/ai/deepseek.ts')
const markdownSample = '## 修改建议\n\n**保留主体轮廓**，调整 `grey shirt`。\n\n1. 先检查提示词\n2. 再生成图片\n\n> 采纳后仍需单独执行\n\n```text\nblack shirt\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 提示词 | 更新 |\n\n[参考说明](https://example.com/guide)'
const markdownAttack = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>\n\n[危险](javascript:alert(1))\n\n![远程图片](https://example.com/tracker.png)\n\n[本地文件](file:///C:/private.txt)'
const { getSettings, saveSettings } = require('../src/main/settings.ts')
const skills = require('../src/main/skills.ts')
const width = 640, height = 896
function image(color, w=width, h=height) { const p = new PNG({ width:w, height:h }); for (let i = 0; i < p.data.length; i += 4) p.data.set(color, i); return p }
function rect(p, x, y, w, h, color) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) p.data.set(color, (j * width + i) * 4) }
const source = image([255, 255, 255, 255])
for (const [x, y, w, h] of [[24,24,592,220], [24,264,280,600], [324,264,292,600]]) {
  rect(source, x, y, w, h, [32,32,32,255]); rect(source, x+4, y+4, w-8, h-8, [243,243,243,255])
}
rect(source, 70, 340, 180, 240, [130,130,130,255]); rect(source, 100, 590, 120, 240, [70,70,70,255])
writeFileSync(join(client.imageDir(), 'page-fixture.png'), PNG.sync.write(source))
const mask = image([0,0,0,255]); rect(mask, 90, 350, 100, 150, [255,255,255,255])
const region = { id: 'region-stable', label: 'AB', instruction: '灰色衣服改成黑色，保留轮廓', target: null, anchor: {x:.2,y:.4}, annotated:true, mask:PNG.sync.write(mask).toString('base64'), accepted:null }
const draft = { base:'monochrome, comic, grey shirt, standing', negative:'blurry', characters:[] }
const params = {width,height,steps:23,scale:5,cfgRescale:0,sampler:'k_euler_ancestral',noiseSchedule:'native',seed:42,count:1,qualityTags:false,ucPreset:'none'}
saveSettings({apiKey:'fixture',baseUrl:'https://fixture.test/v1',model:'fixture-vision',naiToken:'fixture',naiVersion:'v5',naiFreeOnly:true})
const nativeFetch = net.fetch
let aiInputs = [], generationInputs = [], mode = 'change', delay = 0
net.fetch = async (url, init) => {
  if (url.endsWith('/user/subscription')) return Response.json({active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0},usage:{percent:80,isNegative:false}})
  if (url.endsWith('/chat/completions')) {
    const body = JSON.parse(init.body), parts = body.messages[1].content
    assert.ok(Array.isArray(parts))
    const input = JSON.parse(parts[0].text); aiInputs.push({ input, parts, system:body.messages[0].content, messages:body.messages })
    if (delay) await new Promise((resolve,reject) => { const t = setTimeout(resolve,delay); init.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('fixture cancelled'))},{once:true}) })
    if (mode === 'malformed') return Response.json({choices:[{message:{content:'not json'}}]})
    if(mode==='tool' && !body.messages.some(m=>m.role==='tool')) return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'fixture-tool',type:'function',function:{name:'validate_tags',arguments:JSON.stringify({tags:['grey shirt']})}}]}}]})
    const proposed={...input.draft,base:input.draft.base ? input.draft.base.replace('grey shirt','black shirt')+(input.draft.base.includes('black shirt')?', subtle shading':'') : 'A simple grey object stands on a table.'}
    const reply = {reply:markdownSample,understanding:{goal:'调整主体明暗',preserve:'保留主体轮廓'},proposal:mode==='discuss'?null:{title:'调整主体明暗',warning:'请先检查当前提示词与执行方式。',draft:proposed,execution:{kind:mode==='inpaint'?'inpaint':'generate',regionId:mode==='inpaint'?input.currentRegion?.id:null}}}
    return Response.json({choices:[{message:{content:JSON.stringify(reply)}}]})
  }
  assert.equal(url,'https://image.novelai.net/ai/generate-image', 'No unexpected external requests')
  generationInputs.push(JSON.parse(init.body))
  return new Response(PNG.sync.write(image([28,28,28,255], generationInputs.at(-1).parameters.width, generationInputs.at(-1).parameters.height)),{headers:{'content-type':'image/png'}})
}
const openedLinks = []
const handlers = {
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'web:open':(_,url)=>{assert.ok(isWebUrl(url));openedLinks.push(url)},
  'settings:get':()=>getSettings(), 'settings:save':(_,v)=>saveSettings(v),
  'window:dark-titlebar':()=>{}, 'db:status':()=>({loaded:true,tagCount:0,aliasCount:0,zhCount:0,implicationCount:0}),
  'skills:list':()=>skills.getConfig(), 'mcp:info':()=>null, 'update:check':()=>null, 'update:state':()=>null,
  'prompt:analyze':()=>({tokens:[],stats:{total:0,valid:0,alias:0,unknown:0,natural:0,text:0}}),
  'nai:subscription':()=>client.getSubscription(), 'nai:freeCheck':(_, ...args)=>client.freeCheck(...args),
  'nai:list':()=>client.listImages(), 'nai:readImage':(_,name)=>new Uint8Array(readFileSync(client.imagePath(name))),
  'pages:delete':(_,id,rev)=>pages.deletePage(id,rev),
  'pages:list':()=>pages.listPages(), 'pages:read':(_,id)=>pages.readPage(id),
  'pages:create':(_, ...args)=>pages.createPage(...args), 'pages:edit':(_, ...args)=>pages.editPage(...args),
  'pages:chat':(_, ...args)=>collaborator.discussPage(...args), 'pages:cancel':(_,id)=>pages.pageLocks.get(id)?.abort(),
  'pages:generate':(e,id,rev,r)=>collaborator.renderPage(id,rev,r,s=>e.sender.send('nai:step',{id:'fixture',kind:'page-generate',step:s}),()=>false)
}
for (const [name,handler] of Object.entries(handlers)) ipcMain.handle(name,handler)
const pause = ms => new Promise(r=>setTimeout(r,ms))
app.whenReady().then(async()=>{
  let win
  try {
    const { reviewPrompt } = require('../src/main/ai/previewer.ts')
    require('../src/main/tagdb/store.ts').tagStore.load()
    const textRequest={base:'',negative:'',characters:[{prompt:'other',negative:'text'},{prompt:'boy, Text: Hello',negative:''}],version:'v5',params,expectation:''}
    assert.doesNotMatch(await reviewPrompt(textRequest),/角色 1 负面里的 text 会压制/)
    assert.match(await reviewPrompt({...textRequest,characters:[{prompt:'other, Text: Hello',negative:'text'}]}),/角色 1 负面里的 text 会压制/)
    const md=renderMarkdown(markdownSample)
    const payload={reply:markdownSample,proposal:null}
    assert.deepEqual(extractJson(JSON.stringify(payload)),payload)
    assert.deepEqual(extractJson('```json\n'+JSON.stringify(payload)+'\n```'),payload)
    assert.deepEqual(extractJson('说明\n```json\n'+JSON.stringify(payload)+'\n```\n结束'),payload)
    assert.throws(()=>extractJson('not json'))
    for(const tag of ['h2','strong','code','ol','blockquote','pre','table']) assert.ok(md.includes('<'+tag),tag+' renders')
    assert.doesNotMatch(renderMarkdown(markdownAttack),/<(?:script|img)\b|href="(?:javascript:|file:)/i)
    assert.ok(!isWebUrl('file:///C:/private.txt')&&!isWebUrl('javascript:alert(1)')&&!isWebUrl('https://user:pass@example.com'))
    const originalConfig=skills.getConfig().map(s=>({id:s.id,enabled:s.enabled}))
    const custom=skills.createSkill({name:'会话规则测试',scope:'optimize',model:'v5',content:'WORKSPACE_ENABLED_ONLY_MARKER'})
    skills.setConfig(skills.getConfig().map(s=>({id:s.id,enabled:s.id===custom.id})))
    assert.match(skills.composeSkills('workspace','v5').text,/WORKSPACE_ENABLED_ONLY_MARKER/)
    assert.doesNotMatch(skills.composeSkills('workspace','v4.5').text,/WORKSPACE_ENABLED_ONLY_MARKER/)
    skills.setConfig(skills.getConfig().map(s=>({id:s.id,enabled:s.id==='builtin:preview'})))
    const previewSkills=skills.composeSkills('preview','v5')
    assert.equal(previewSkills.skills.length,1)
    assert.doesNotMatch(previewSkills.text,/参考知识（摘自《内置 · 提示词编排》/)
    assert.ok(!previewSkills.text.includes('<skill priority="2"'))
    assert.ok(!previewSkills.text.includes(skills.getSkill('builtin:prompt').content.trim()))
    skills.setConfig(skills.getConfig().map(s=>({id:s.id,enabled:s.id===custom.id})))
    let w=await pages.createPage(null,params,'v5',{base:'',negative:'',characters:[]})
    const id=w.id, original=w.currentVersionId
    const edit=a=>w=pages.editPage(id,w.revision,a)
    const talk=async(text,r=null,refs=[])=>w=await collaborator.discussPage(id,w.revision,text,r,refs)
    const proposal=()=>w.messages.findLast(m=>m.proposal)
    const decide=decision=>edit({type:'proposal',messageId:proposal().id,decision})
    assert.equal(pageCurrent(w).image,null);assert.equal(generationInputs.length,0)
    await talk('我要一个灰色物体，保留主体轮廓')
    assert.equal(aiInputs.at(-1).parts.filter(p=>p.type==='image_url').length,0)
    assert.equal(w.goal,'调整主体明暗');assert.equal(w.preserve,'保留主体轮廓')
    assert.match(aiInputs.at(-1).system,/WORKSPACE_ENABLED_ONLY_MARKER/)
    assert.doesNotMatch(aiInputs.at(-1).system,/漫画成品页|先列单元表/)
    assert.equal(pageCurrent(w).editor.draft.base,'');decide('accept')
    assert.match(pageCurrent(w).editor.draft.base,/grey object/)
    decide('undo');assert.equal(pageCurrent(w).editor.draft.base,'')
    const replacedId=proposal().id
    await talk('按刚才的目标继续')
    assert.equal(w.messages.filter(m=>m.versionId===original&&m.proposal).length,2)
    assert.ok(w.messages.find(m=>m.id===replacedId).proposal.superseded);assert.ok(w.messages.find(m=>m.id===replacedId).proposal.before)
    assert.throws(()=>edit({type:'proposal',messageId:replacedId,decision:'accept'}),/已有更新|已变化/)
    decide('accept')
    w=await collaborator.renderPage(id,w.revision,w.execution,()=>{},()=>false)
    assert.equal(generationInputs.at(-1).action,'generate');assert.ok(!generationInputs.at(-1).parameters.image)
    assert.equal(pageCurrent(w).parentId,original);assert.deepEqual(pageCurrent(w).generated.draft,pageCurrent(w).editor.draft)
    const generated=w.currentVersionId
    assert.equal(pageIteration(w,generated).before.draft.base,'','first iteration compares immutable session start')
    assert.ok(pageIteration(w,generated).changes.length)
    const firstSnapshot=structuredClone(pageCurrent(w).generated)
    edit({type:'editor',versionId:generated,editor:{...pageCurrent(w).editor,draft,regions:[region]}})
    assert.equal(w.execution.kind,'generate','annotations never choose execution mode')
    mode='change';await talk('我圈出的是这个部位，请调整提示词',region.id)
    assert.equal(aiInputs.at(-1).parts.filter(p=>p.type==='image_url').length,2)
    assert.equal(proposal().proposal.execution.kind,'generate')
    edit({type:'execution',execution:{kind:'inpaint',regionId:region.id}})
    assert.throws(()=>decide('accept'),/变化/);decide('reject')
    mode='inpaint';await talk('这次只重绘这个遮罩内的部位',region.id);decide('accept')
    const before=PNG.sync.read(readFileSync(client.imagePath(pageCurrent(w).image.name)))
    w=await collaborator.renderPage(id,w.revision,w.execution,()=>{},()=>false)
    assert.equal(generationInputs.at(-1).action,'infill');assert.match(generationInputs.at(-1).input,/black shirt/)
    const result=PNG.sync.read(readFileSync(client.imagePath(pageCurrent(w).image.name)))
    for(let i=0;i<before.data.length;i+=4)if(!mask.data[i])assert.ok(before.data.subarray(i,i+4).equals(result.data.subarray(i,i+4)))
    const snapshot=structuredClone(pageCurrent(w).generated)
    assert.deepEqual(pageIteration(w,w.currentVersionId).before,firstSnapshot,'compare actual source generation, not its modified editor')
    assert.ok(pageIteration(w,w.currentVersionId).changes.length)
    assert.equal(snapshot.inpaint.instruction,region.instruction)
    assert.equal(snapshot.inpaint.label,region.label)
    assert.equal(snapshot.inpaint.mask,region.mask);assert.equal(snapshot.inpaint.strength,pageCurrent(w).editor.strength)
    edit({type:'editor',versionId:w.currentVersionId,editor:{...pageCurrent(w).editor,draft:{...pageCurrent(w).editor.draft,base:'A different object.'}}})
    assert.deepEqual(pageCurrent(w).generated,snapshot,'generated prompt remains immutable after editing')
    assert.deepEqual(pageIteration(w,w.currentVersionId).result,snapshot)
    const old=structuredClone(w);delete old.versions.find(v=>v.id===generated).generated
    assert.equal(pageIteration(old,old.currentVersionId).before,undefined,'missing historical snapshot must not fall back to edited draft')
    assert.ok(w.messages.at(-1).draftBefore)
    const retainedProposalId=proposal().id
    mode='discuss';await talk('参考上一版，先讨论',region.id,[generated]);assert.equal(aiInputs.at(-1).parts.filter(p=>p.type==='image_url').length,3)
    assert.equal(proposal().id,retainedProposalId,'discussion without a new proposal does not erase latest suggestion')
    const {tagStore}=require('../src/main/tagdb/store.ts');tagStore.loaded=true
    mode='tool';await talk('先查证这个词，再给方案')
    assert.ok(aiInputs.at(-1).messages.some(m=>m.role==='tool'&&m.tool_call_id==='fixture-tool'));tagStore.loaded=false
    mode='malformed';await assert.rejects(talk('格式错误测试'));w=pages.readPage(id);assert.ok(!pages.pageLocks.has(id))
    mode='discuss';delay=1000;const count=aiInputs.length, cancelled=talk('取消测试')
    while(aiInputs.length===count)await pause(10)
    assert.throws(()=>pages.deletePage(id,w.revision),/等待/);pages.pageLocks.get(id).abort();await assert.rejects(cancelled);delay=0;w=pages.readPage(id)
    assert.ok(!pages.pageLocks.has(id));assert.match(w.messages.at(-1).text,/取消/)
    edit({type:'switch',versionId:original});assert.equal(pageCurrent(w).image,null)
    w=await collaborator.renderPage(id,w.revision,w.execution,()=>{},()=>false);assert.equal(pageCurrent(w).parentId,original)
    assert.equal(pageIteration(w,w.currentVersionId).source.id,original,'branches compare actual parent, not chronological predecessor')
    assert.equal(pageIteration(w,w.currentVersionId).before.draft.base,'')
    const imported=await pages.importPage(join(client.imageDir(),'page-fixture.png'),params,'v5',draft)
    const importedName=pageCurrent(imported).image.name;assert.notEqual(importedName,'page-fixture.png')
    assert.throws(()=>pages.deletePage(imported.id,imported.revision-1),/更新/)
    pages.deletePage(imported.id,imported.revision);assert.ok(!pages.listPages().some(s=>s.id===imported.id));assert.ok(client.imagePath(importedName))
    const legacy=await pages.createPage('page-fixture.png',params,'v5',draft)
    legacy.schema=1;delete legacy.execution;pageCurrent(legacy).editor.regions=[{...region,accepted:{...draft,base:'Legacy accepted draft.'}}];pages.savePage(legacy)
    const migrated=pages.readPage(legacy.id);assert.equal(migrated.schema,2);assert.equal(migrated.versions.length,2);assert.equal(migrated.versions[1].editor.draft.base,'Legacy accepted draft.')
    assert.deepEqual(pages.readPage(legacy.id),migrated,'migration occurs once and keeps IDs stable')
    skills.setConfig([...originalConfig,{id:custom.id,enabled:false}])
    console.log('PASS blank sessions, enabled Skill isolation, conversation memory, prompt adoption/undo, explicit execution, tool use, generation snapshots, references, migration, deletion, cancellation and outside-mask pixels')

    protocol.handle('np-img',req=>nativeFetch(pathToFileURL(client.imagePath(decodeURIComponent(new URL(req.url).pathname.slice(1)))).toString()))
    win=new BrowserWindow({width:1440,height:960,show:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#6b6c75',height:40},webPreferences:{preload:join(__dirname,'../out/preload/index.js'),sandbox:false,backgroundThrottling:false,offscreen:true}})
    const js=code=>win.webContents.executeJavaScript(code,true)
    const run=async code=>{const v=await js(code);await pause(100);return v}
    const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await pause(50)}throw new Error('Timed out: '+code)}
    const click=(selector,text)=>run(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})&&e.getClientRects().length&&!e.disabled);if(!e)throw new Error('Missing button '+${JSON.stringify(text)});e.click()})()`)
    const input=(selector,value)=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const shot=async name=>{await pause(300);writeFileSync(join(artifacts,name),(await win.webContents.capturePage()).toPNG())}
    await win.loadFile(join(__dirname,'../out/renderer/index.html'));await pause(600)
    await click('.nav-item','生图预览');assert.equal(await js(`document.querySelectorAll('.page-library').length`),0)
    const beforeImageStart=pages.listPages().length, apiBefore=[aiInputs.length,generationInputs.length]
    await run(`document.querySelector('.gallery .thumb').click()`)
    const chosenUrl=await js(`document.querySelector('.viewer-stage img').getAttribute('src')`)
    await click('.viewer button','用于新会话');await wait(`!!document.querySelector('.session-image img')`)
    assert.equal(await js(`document.querySelector('.session-image img').getAttribute('src')`),chosenUrl)
    assert.equal(pages.listPages().length,beforeImageStart,'image handoff does not create a session')
    await input('.session-create input','图库起点测试');await shot('10-image-session-start.png')
    await click('.session-image button','重新选择');await click('.viewer button','用于新会话');await wait(`!!document.querySelector('.session-image img')`)
    assert.equal(await js(`document.querySelector('.session-create input').value`),'图库起点测试','reselect preserves session name')
    await click('.session-create button','开始会话');await wait(`!!document.querySelector('.pw-shell')`)
    const fromImage=pages.listPages().find(p=>p.title==='图库起点测试');assert.ok(fromImage);assert.equal(fromImage.image.url,chosenUrl)
    assert.deepEqual([aiInputs.length,generationInputs.length],apiBefore,'starting from an image makes no model calls')
    await click('.pw-header button','返回会话');await click('.nav-item','生图预览');await click('.viewer button','用于新会话');await wait(`!!document.querySelector('.session-image img')`)
    await run(`document.querySelector('.session-create [title="取消新建"]').click()`);assert.equal(pages.listPages().length,beforeImageStart+1,'cancel creates no extra record')
    const n=pages.listPages().length;await click('.nav-item','AI 工作台');await shot('00-session-list.png');await click('.sessions-home header button','新建会话')
    assert.equal(pages.listPages().length,n,'opening creation form creates nothing')
    await input('.session-create input','通用创作会话测试');await click('.session-create button','开始会话');await wait(`!!document.querySelector('.pw-shell')`)
    let ui=pages.listPages().find(p=>p.title==='通用创作会话测试');assert.ok(ui);assert.equal(ui.image,null)
    await shot('01-new-session.png')
    mode='change';await input('.pw-input-wrap textarea','我想生成一个灰色物体，保留主体轮廓');await run(`document.querySelector('.pw-send').click()`)
    await wait(`!!document.querySelector('.pw-plan-link')&&!document.querySelector('.pw-thinking')`)
    assert.ok(await js(`!!document.querySelector('.pw-canvas-bar')&&!document.querySelector('.pw-suggestion-board')`),'new proposal does not navigate away from canvas')
    await click('.pw-plan-link','查看提示词建议');await wait(`!!document.querySelector('.pw-suggestion-board .pw-proposal')`)
    assert.ok(await js(`!!document.querySelector('.markdown-text h2')&&!!document.querySelector('.markdown-text strong')&&!!document.querySelector('.markdown-text ol')&&!!document.querySelector('.markdown-text pre code')&&!!document.querySelector('.markdown-text table')`))
    await run(`document.querySelector('.markdown-text a').click()`);assert.deepEqual(openedLinks,['https://example.com/guide'])
    await shot('12-markdown-suggestion-tab.png')
    assert.equal(pageCurrent(pages.readPage(ui.id)).editor.draft.base,'')
    assert.ok(await js(`!document.querySelector('.pw-understanding') && !document.querySelector('.pw-header').textContent.includes('已保存到本机')`))
    assert.ok(await js(`document.querySelector('.pw-header').getBoundingClientRect().height<=48`))
    assert.ok(await js(`document.querySelector('.skill-trigger').textContent.includes('已启用 3 个 Skill') && document.querySelector('.skill-trigger').getBoundingClientRect().height<50`))
    await click('.pw-rename','通用创作会话测试');await input('.pw-heading input','会话重命名测试');await run(`document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);assert.equal(pages.readPage(ui.id).title,'会话重命名测试')
    await click('.pw-rename','会话重命名测试');await input('.pw-heading input','通用创作会话测试');await run(`document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await click('.pw-suggestion-board button','采纳方案')
    await click('.pw-view-tabs button','当前提示词');assert.ok(await js(`document.querySelector('.workspace-prompt').textContent.includes('grey object')`))
    await shot('02-current-prompt.png')
    await click('.pw-execution button','生成新版本');await wait(`document.querySelector('.pw-canvas-bar b')?.textContent==='版本 1'`)
    await click('.pw-canvas-actions button','区域批注');await wait(`document.querySelector('.ip-active-mask')?.getBoundingClientRect().width>100`);await pause(300)
    const bounds=await js(`(()=>{const r=document.querySelector('.ip-active-mask').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
    const point=(x,y)=>({x:Math.round(bounds.x+bounds.w*x),y:Math.round(bounds.y+bounds.h*y)})
    win.webContents.sendInputEvent({type:'mouseMove',...point(.2,.4)});await pause(30)
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point(.2,.4)});await pause(30)
    win.webContents.sendInputEvent({type:'mouseMove',...point(.25,.5)});await pause(30)
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point(.25,.5)});await pause(80)
    win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point(.23,.46)});win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point(.23,.46)})
    await wait(`!!document.querySelector('.ip-context-menu')`);await click('.ip-context-menu button','新增批注');await input('.ip-comment textarea','我指的是这个位置');await click('.ip-comment button','完成批注');await click('.ip-foot button','保存并返回讨论');await wait(`!document.querySelector('.ip-dialog')`)
    assert.equal(pages.readPage(ui.id).execution.kind,'generate')
    mode='inpaint';await input('.pw-input-wrap textarea','这次只重绘刚才的区域');await run(`document.querySelector('.pw-send').click()`);await wait(`document.querySelectorAll('.pw-plan-link').length===2&&!document.querySelector('.pw-thinking')`)
    await run(`document.querySelectorAll('.pw-plan-link')[1].click()`);await wait(`document.querySelector('.pw-suggestion-board')?.textContent.includes('局部重绘')`)
    await click('.pw-suggestion-board button','采纳方案');assert.equal(pages.readPage(ui.id).execution.kind,'inpaint')
    await shot('03-proposal-and-execution.png')
    await click('.pw-execution button','检查遮罩');await shot('04-mask-review.png')
    await click('.pw-execution button','执行局部重绘');await wait(`document.querySelector('.pw-canvas-bar b')?.textContent==='版本 2'`)
    await click('.pw-plan-link','调整主体明暗');assert.ok(await js(`document.querySelector('.pw-suggestion-heading').textContent.includes('起点')`));assert.ok(await js(`document.querySelector('.pw-canvas-bar')===null`))
    await click('.pw-suggestion-board button','回到当前版本');assert.ok(await js(`document.querySelector('.pw-suggestion-board').textContent.includes('此版本暂无修改建议')`))
    await click('.pw-view-tabs button','修改对比');assert.ok(await js(`!document.querySelector('.pw-change-board article.pw-proposal')`),'AI suggestions are separate from iteration history')
    assert.ok(await js(`document.querySelector('.wi-heading').textContent.includes('版本 1 → 版本 2')&&document.querySelector('.wi-heading').textContent.includes('局部重绘')`))
    assert.equal(await js(`document.querySelectorAll('.wi-images img').length`),2)
    assert.ok(await js(`(()=>{const rows=[...document.querySelectorAll('.wi-timeline button')];return rows.every(b=>Math.abs(b.getBoundingClientRect().top-rows[0].getBoundingClientRect().top)<1)})()`),'iteration navigation stays in one horizontal row')
    await run(`document.querySelector('.wi-mask').open=true`);await shot('11-iteration-history.png')
    await click('.wi-timeline button','版本 1');assert.ok(await js(`document.querySelector('.wi-heading').textContent.includes('起点 → 版本 1')`))
    assert.equal(pages.readPage(ui.id).currentVersionId,pages.readPage(ui.id).versions[2].id,'review does not switch current version')
    await click('.wi-timeline button','版本 2')
    await click('.pw-view-tabs button','当前提示词');await click('.pw-prompt-actions button','编辑');
    const sharedValues=await js(`[...document.querySelectorAll('.view textarea,.view .char-head input')].map(e=>e.value)`)
    const moveCharacter=async(x,y)=>{
      await click('.workspace-prompt button','添加角色');await input('.workspace-characters textarea','A person stands at the selected position.')
      await run(`document.querySelector('.workspace-characters [title="编辑位置"]').click()`);await wait(`!!document.querySelector('.pos-reference-image')`);await pause(250)
      const r=await js(`(()=>{const r=document.querySelector('.pos-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
      const pt={x:Math.round(r.x+r.w*x),y:Math.round(r.y+r.h*y)}
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pt});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pt});await pause(100)
      assert.equal(await js(`document.querySelector('.pos-input').value`),`${x},${y}`)
      const dot=await js(`(()=>{const r=document.querySelector('.pos-dot').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      const moved={x:Math.round(r.x+r.w*.4),y:Math.round(r.y+r.h*.5)}
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...dot});win.webContents.sendInputEvent({type:'mouseMove',...moved});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...moved});await pause(100)
      assert.equal(await js(`document.querySelector('.pos-input').value`),'0.4,0.5','drag writes local character coordinates')
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await pause(50)
      assert.equal(await js(`document.querySelector('.pos-input').value`),'0.41,0.5','arrow key nudges local coordinates')
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pt});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pt});await pause(80)

      assert.equal(await js(`document.querySelector('.pos-reference-image').getAttribute('src')`),pageCurrent(pages.readPage(ui.id)).image.url)
      await shot('07-workspace-position.png');await click('.pos-foot button','完成');await wait(`!document.querySelector('.pos-mask')`)
      assert.equal(await js(`document.querySelector('.workspace-characters .char-head input').value`),`${x},${y}`)
      assert.deepEqual(await js(`[...document.querySelectorAll('.view textarea,.view .char-head input')].map(e=>e.value)`),sharedValues,'local position editor does not modify shared prompts')
      await run(`document.querySelector('.workspace-characters').scrollIntoView({block:'start'})`);await shot('08-character-layout.png')
    }
    await moveCharacter(.25,.7)
    const countBeforeBlocked=pages.listPages().length
    await click('.nav-item','生图预览');await click('.viewer button','用于新会话');await wait(`!!document.querySelector('.pw-error')`)
    assert.ok(await js(`!!document.querySelector('.workspace-prompt fieldset')&&!document.querySelector('.session-create')`),'image handoff preserves an unsaved editor')
    assert.equal(pages.listPages().length,countBeforeBlocked)
    await run(`document.querySelector('.pw-error button').click()`)

    const longPrompt=Array(35).fill('A long prompt with details about the subject and background.').join('\n')
    await input('.workspace-prompt textarea',longPrompt);await pause(100)
    assert.ok(await js(`(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.clientHeight>600 && t.scrollHeight<=t.clientHeight+1})()`),'long prompt expands without internal scrolling')
    await run(`document.querySelector('.workspace-prompt').scrollTop=100000`)
    assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('.pw-prompt-actions button')].find(b=>b.textContent.includes('保存草稿'));const r=b.getBoundingClientRect();return r.top>0&&r.bottom<180})()`),'save stays in the fixed top toolbar')
    win.setSize(1100,760);await pause(300);await shot('06-long-prompt-toolbar.png')
    assert.ok(await js(`(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.scrollHeight<=t.clientHeight+1})()`),'resize recalculates wrapping')
    await click('.nav-item','Tag 搜索');await click('.nav-item','AI 工作台');await pause(100)
    assert.ok(await js(`(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.scrollHeight<=t.clientHeight+1})()`),'hidden pane resumes correct height')
    await click('.pw-prompt-actions button','取消编辑');assert.equal(pageCurrent(pages.readPage(ui.id)).editor.draft.characters.length,0,'cancel discards position changes');await click('.pw-prompt-actions button','编辑');await moveCharacter(.3,.6);await input('.workspace-prompt textarea','A revised grey object stands on a table.');
    assert.ok(await js(`document.querySelector('.workspace-prompt textarea').clientHeight<200`),'short prompt shrinks back')
    win.setSize(1440,960);await pause(150);await click('.pw-prompt-actions button','保存草稿');await wait(`!document.querySelector('.workspace-prompt fieldset')`)
    const saved=pages.readPage(ui.id);assert.equal(pageCurrent(saved).editor.draft.characters[0].position,'0.3,0.6');assert.ok(saved.messages.some(m=>m.draftBefore));assert.notEqual(pageCurrent(saved).generated.draft.base,pageCurrent(saved).editor.draft.base)
    await click('.pw-view-tabs button','修改对比');await run(`document.querySelector('details.pw-proposal').open=true`);await shot('09-context-diff.png');assert.ok(await js(`!!document.querySelector('.diff-prose')&&!document.querySelector('.pw-change-board').textContent.includes('句内：')`));
    mode='change'
    for (const text of ['给当前版本一个新建议','再给一份最新建议']) {
      const count=await js(`document.querySelectorAll('.pw-message.assistant').length`)
      await input('.pw-input-wrap textarea',text);await run(`document.querySelector('.pw-send').click()`)
      await wait(`document.querySelectorAll('.pw-message.assistant').length===${count+1}&&!document.querySelector('.pw-thinking')`)
    }
    assert.ok(await js(`!!document.querySelector('.pw-change-board')`),'new suggestions do not interrupt comparison')
    const latest=pages.readPage(ui.id)
    assert.ok(latest.messages.filter(m=>m.proposal&&m.versionId===latest.currentVersionId).length>=2)
    await run(`[...document.querySelectorAll('.pw-plan-link')].at(-1).click()`)
    assert.equal(await js(`document.querySelectorAll('.pw-suggestion-board article.pw-proposal').length`),1)
    assert.ok(await js(`document.querySelector('.pw-suggestion-heading').textContent.includes('版本 2')`))
    await shot('13-latest-suggestion.png')
    await click('.pw-header button','历史');assert.ok(await js(`!document.querySelector('.pw-history').textContent.includes('种子')&&!document.querySelector('.pw-history').textContent.includes('点击查看')`));await click('.pw-version b','版本 1');await wait(`!!document.querySelector('.pw-history-banner')`)
    await click('.pw-history-banner button','引用此版');mode='discuss';await input('.pw-input-wrap textarea','参考这版，先讨论');await run(`document.querySelector('.pw-send').click()`);await wait(`!document.querySelector('.pw-thinking')`)
    assert.equal(aiInputs.at(-1).input.currentVersion.label,'版本 2');assert.equal(aiInputs.at(-1).input.referencedVersions[0].label,'版本 1')
    await click('.pw-history-banner button','从此版继续');await wait(`!document.querySelector('.pw-history-banner')`)
    await input('.pw-input-wrap textarea','下次继续调整');await click('.pw-header button','返回会话');await wait(`!document.querySelector('.pw-shell')`)
    await click('.session-open','通用创作会话测试');await wait(`!!document.querySelector('.pw-shell')`);assert.equal(await js(`document.querySelector('.pw-input-wrap textarea').value`),'下次继续调整')
    assert.equal(await js(`document.querySelector('.pw-canvas-bar b').textContent`),'版本 1')
    win.setSize(1100,760);await pause(300);await shot('05-compact-session.png')
    assert.ok(await js(`document.querySelector('.pw-shell').scrollWidth<=document.querySelector('.pw-shell').clientWidth+1`))
    await click('.pw-header button','返回会话');await wait(`!document.querySelector('.pw-shell')`)
    await run(`(()=>{const card=[...document.querySelectorAll('.session-card')].find(e=>e.textContent.includes('通用创作会话测试'));card.querySelector('.session-delete').click()})()`)
    await click('.session-remove button','确认删除');assert.ok(!pages.listPages().some(s=>s.id===ui.id));assert.ok(client.imagePath(pageCurrent(saved).image.name))
    console.log('PASS compact Skill count, 46px header, explicit rename, growing textareas, pinned save/cancel, resize and hidden-pane recovery; independent UI, intentional creation, conversation-derived goals, final prompt, review panel, annotation/mode separation, generation, manual history, reference/restore, reopen and deletion at 1440/1100 widths')
    console.log('Artifacts:',artifacts)
  } catch(e) { console.error(e);process.exitCode=1;if(win){writeFileSync(join(artifacts,'failure.png'),(await win.webContents.capturePage()).toPNG());writeFileSync(join(artifacts,'failure.txt'),await win.webContents.executeJavaScript('document.body.innerText'))} }
  finally { app.exit(process.exitCode||0) }
})
