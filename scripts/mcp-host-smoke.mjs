// Cold-start the actual built application in an isolated profile; never call paid providers.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)), electron=createRequire(import.meta.url)('electron')
const profile=mkdtempSync(join(tmpdir(),'np-mcp-host-')), clients=[], hosts=new Set()
const packagedExe=process.env.NP_PACKAGED_EXECUTABLE ? resolve(process.env.NP_PACKAGED_EXECUTABLE) : null
function agent() {
  const child=spawn(packagedExe??electron,packagedExe?[join(dirname(packagedExe),'resources/mcp-proxy.cjs')]:[join(root,'scripts/mcp-proxy.cjs'),root],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NOVELPROMPT_USER_DATA:profile},stdio:['pipe','pipe','pipe']})
  const waiting=new Map();let sequence=0,errors=''
  child.stderr.on('data',b=>errors+=b)
  createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line),w=waiting.get(m.id);if(w){clearTimeout(w.timer);waiting.delete(m.id);w.resolve(m)}})
  child.on('exit',code=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('Proxy exited '+code+': '+errors))}waiting.clear()})
  const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Timeout '+method+': '+errors))},40000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
  const c={child,request,async data(name,args={}){const m=await request('tools/call',{name,arguments:args});if(m.error||m.result?.isError)throw Error(m.error?.message||m.result.content[0].text);return m.result.structuredContent??JSON.parse(m.result.content[0].text)}}
  clients.push(c);return c
}
const init=c=>c.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'host-smoke',version:'1'}})
try {
  const a=agent(),b=agent();const initialized=await Promise.all([init(a),init(b)])
  assert.ok(initialized[0].result.instructions.includes('agent_guide(topic=overview)'))
  assert.equal(initialized[0].result.capabilities.resources.subscribe,true)
  const [x,y]=await Promise.all([a.data('get_app_state'),b.data('get_app_state')]);hosts.add(x.hostPid)
  assert.equal(x.hostPid,y.hostPid);assert.equal(x.visible,false);assert.equal(x.desktop,null)
  if(packagedExe)assert.equal(x.version,createRequire(import.meta.url)('../package.json').version)
  const guide=await a.data('prompt_guide',{detail:'summary'});assert.ok(guide.fingerprint);assert.ok(JSON.stringify(guide).length<5000)
  const overview=await a.data('agent_guide');assert.equal(overview.topic,'overview');assert.ok(overview.content.includes('前台'))
  const full=await a.data('agent_guide',{topic:'all'})
  for(const topic of overview.topics.filter(t=>t!=='all')) {
    const part=await a.data('agent_guide',{topic});assert.equal(part.fingerprint,full.fingerprint);assert.ok(full.content.includes(part.content))
  }
  assert.ok(full.content.includes('show:false'));assert.ok(full.content.includes('不自动唤醒'))
  const resources=await a.request('resources/list')
  assert.ok(resources.result.resources.some(r=>r.uri===overview.uri))
  const resource=await a.request('resources/read',{uri:overview.uri});assert.equal(resource.result.contents[0].text,full.content)
  assert.ok((await a.request('resources/read',{uri:'novelprompt://app/state'})).result.contents[0].text)
  assert.equal((await a.request('resources/read',{uri:'novelprompt://guide/missing'})).error.code,-32602)
  await assert.rejects(a.data('agent_guide',{topic:'missing'}),/未知指南/)
  assert.equal((await a.data('get_app_state')).visible,false)
  assert.equal((await a.request('tools/list')).result.tools.length,51)
  console.log('PASS agent onboarding in initialize; guide topics/resource share content and fingerprint; invalid topic/resource rejected; reading keeps host headless')
  const w=await a.data('create_workspace',{title:'冷启动持久化测试',draft:{base:'1girl',negative:'',characters:[]},show:false})
  a.child.stdin.end();await b.request('ping')
  assert.equal((await b.data('get_workspace',{id:w.id})).id,w.id)
  console.log('PASS concurrent proxy cold-start uses one actual host; headless operation, compact guide, persistent workspace, disconnect isolation')
  process.kill(x.hostPid)
  await new Promise(r=>setTimeout(r,1000))
  const c=agent();await init(c)
  const restarted=await c.data('get_app_state');hosts.add(restarted.hostPid);assert.notEqual(restarted.hostPid,x.hostPid)
  assert.equal((await c.data('get_workspace',{id:w.id})).id,w.id)
  console.log('PASS stale endpoint recovery, new host after crash, persisted workspace retained; no requests replayed')
  assert.ok((await c.request('tools/list')).result.tools.some(t=>t.name==='ui_create_workspace'))
  const opened=await c.data('ui_open_workspace',{id:w.id})
  assert.equal(opened.tab,'workspace');assert.equal(opened.workspace.id,w.id)
  assert.equal((await c.data('get_app_state')).visible,true)
  console.log('PASS foreground tool opens a real window from headless host and waits for renderer readiness')
} catch(e) { console.error(e);process.exitCode=1 }
finally { for(const c of clients)c.child.stdin.end();await new Promise(r=>setTimeout(r,200));for(const pid of hosts){try{process.kill(pid)}catch{}}for(const c of clients)c.child.kill() }
