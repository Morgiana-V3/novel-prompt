// Offline contract tests, isolated profile; every network call is intercepted.
const { app, net } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript'), { PNG } = require('pngjs')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'np-inpaint-mcp-')))
app.getAppPath = () => join(__dirname, '..')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f)
const { buildTools } = require('../src/main/mcp/tools.ts')
const { imageDir, imagePath } = require('../src/main/nai/client.ts')
const { saveSettings } = require('../src/main/settings.ts')
const { diffTags } = require('../src/renderer/src/tag-diff.ts')
const { diffPrompt, changedWords, wordParts } = require('../src/renderer/src/prompt-diff.ts')
const source = new PNG({width:128,height:64}); source.data.fill(255)
const sourceBytes = PNG.sync.write(source)
writeFileSync(join(imageDir(), 'test.png'), sourceBytes)
saveSettings({mcpAllowAi:true,mcpAllowGenerate:true,apiKey:'fixture',baseUrl:'https://fixture.test',model:'fixture',naiToken:'fixture'})
let calls=0, aiCalls=0, lastBody, cancelOnGenerate
net.fetch = async (url, init) => {
  if(url.endsWith('/user/subscription'))return Response.json({active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0},usage:{percent:80,isNegative:false}})
  if(url.endsWith('/chat/completions')) {
    aiCalls++; const body=JSON.parse(init.body), content=body.messages[1].content
    assert.ok(Array.isArray(content)); assert.equal(content.filter(p=>p.type==='image_url').length,2)
    const input=JSON.parse(content[0].text)
    return Response.json({choices:[{message:{content:JSON.stringify({plans:input.regions.map(r=>({id:r.id,summary:'修改',warning:'',changes:[{field:'base',after:'red apple',reason:'颜色'}]}))})}}]})
  }
  assert.equal(url,'https://image.novelai.net/ai/generate-image')
  calls++; lastBody=JSON.parse(init.body)
  cancelOnGenerate?.abort()
  const result=new PNG({width:128,height:64}); for(let i=0;i<result.data.length;i+=4)result.data.set([0,50,150,255],i)
  return new Response(PNG.sync.write(result),{headers:{'content-type':'image/png'}})
}
app.whenReady().then(async()=>{
  try {
    const tools=buildTools(), controller=new AbortController()
    const find=n=>{const t=tools.find(t=>t.name===n);assert.ok(t);return t}
    const call=async(n,a)=>{const t=find(n);const denied=t.gate?.();if(denied)throw new Error(denied);return t.run(a,controller.signal)}
    for(const n of ['inpaint_guide','prepare_inpaint','plan_inpaint','inpaint_image']) find(n)
    assert.ok((await call('inpaint_guide',{version:'v5'})).includes('局部重绘提示词优化'))
    const args={image_name:'test.png',rectangles:[{x:93,y:35,width:23,height:17}]}
    const prepared=JSON.parse(await call('prepare_inpaint',args))
    assert.equal(prepared.selected_pixels,23*17);assert.deepEqual(prepared.bounds,{x:93,y:35,width:23,height:17})
    const mask=PNG.sync.read(readFileSync(prepared.mask_path));assert.equal(mask.width,128);assert.equal(mask.height,64)
    assert.deepEqual([...mask.data.subarray(0,4)],[0,0,0,255]);assert.equal(mask.data[(40*128+100)*4],255)
    assert.ok(!readFileSync(prepared.preview_path).equals(sourceBytes))
    assert.ok(readFileSync(imagePath('test.png')).equals(sourceBytes))
    assert.equal(calls+aiCalls,0)
    const draft={base:'green apple',negative:'blurry',characters:[]}
    const plan=JSON.parse(await call('plan_inpaint',{image_name:'test.png',...draft,regions:[{id:'stable-id',instruction:'改成红苹果',mask_path:prepared.mask_path}]}))
    assert.equal(plan.plans[0].id,'stable-id');assert.equal(plan.plans[0].changes[0].before,'green apple');assert.equal(plan.mode,'vision');assert.equal(calls,0)
    await assert.rejects(call('plan_inpaint',{...args,...draft,regions:[{id:'a',instruction:'改色',rectangles:args.rectangles},{id:'a',instruction:'改色',rectangles:args.rectangles}]}),/区域/)
    assert.equal(aiCalls,1)
    const gen={...args,...draft,confirm:true,version:'v5',seed:42}
    const result=JSON.parse(await call('inpaint_image',gen));assert.equal(result.images.length,1);assert.equal(result.stopped,null);assert.equal(result.anlasChange,0)
    assert.equal(lastBody.action,'infill');assert.ok(!('img2img' in lastBody.parameters));assert.equal(lastBody.input,'green apple')
    const wire=PNG.sync.read(Buffer.from(lastBody.parameters.mask,'base64'))
    assert.equal(wire.width,128);assert.equal(wire.height,64)
    for(let y=0;y<64;y++)for(let x=0;x<128;x++) {
      const i=(y*128+x)*4, expected=x>=88&&x<120&&y>=32&&y<56?255:0
      assert.deepEqual([...wire.data.subarray(i,i+4)],[expected,expected,expected,255])
    }
    const saved=PNG.sync.read(readFileSync(result.images[0].path));let changed=0
    for(let i=0;i<saved.data.length;i+=4)if(!mask.data[i])assert.ok(saved.data.subarray(i,i+4).equals(source.data.subarray(i,i+4)));else changed++
    assert.equal(changed,23*17)
    await assert.rejects(call('inpaint_image',{...gen,confirm:false}),/confirm/)
    await assert.rejects(call('inpaint_image',{...gen,strength:2}),/参数/)
    await assert.rejects(call('inpaint_image',{...gen,steps:29}),/参数/)
    await assert.rejects(call('inpaint_image',{...gen,sampler:'bad'}),/sampler/)
    await assert.rejects(call('prepare_inpaint',{...args,mask_path:prepared.mask_path}),/只能/)
    await assert.rejects(call('prepare_inpaint',{...args,rectangles:[{x:127,y:0,width:2,height:1}]}),/矩形/)
    await assert.rejects(call('prepare_inpaint',{...args,image_name:'../settings.json'}),/image_name/)
    await assert.rejects(call('prepare_inpaint',{image_name:'test.png',mask_base64:'nope'}),/PNG/)
    assert.equal(calls,1)
    // Cancellation after submission keeps the saved single image and must stop the agent's next step.
    for (const [name, args] of [['inpaint_image',gen], ['generate_image',{base:'1girl',width:128,height:64,confirm:true,seed:42}]]) {
      cancelOnGenerate = new AbortController()
      const stopped = JSON.parse(await find(name).run(args,cancelOnGenerate.signal))
      assert.equal(stopped.images.length,1); assert.match(stopped.stopped,/已停止/)
    }
    cancelOnGenerate = undefined
    saveSettings({mcpAllowAi:false,mcpAllowGenerate:false})
    await assert.rejects(call('plan_inpaint',{}),/开启/);await assert.rejects(call('inpaint_image',{}),/开启/)
    const diff=diffTags('girl, black hair, 1.2::smile::, short hair','girl, black hair, 1.4::smile::, long hair')
    assert.deepEqual(diff.added.map(t=>t.key),['long hair']);assert.deepEqual(diff.removed.map(t=>t.key),['short hair']);assert.equal(diff.changed.length,1)
    const prose=diffPrompt('girl, bob cut, Her black bob touches her shoulders. Her dress stays grey.', 'girl, long hair, Her black hair falls past her shoulders. Her dress stays grey.')
    assert.ok(prose.added.some(t=>t.text==='long hair'));assert.ok(prose.removed.some(t=>t.text==='bob cut'))
    assert.ok(prose.added.some(t=>t.text.includes('hair')));assert.ok(![...prose.added,...prose.removed].some(t=>t.text.includes('dress stays')))
    assert.deepEqual(changedWords('Text: 来了来了','Text: 等一下'),{removed:['来了来了'],added:['等一下']})
    assert.deepEqual(changedWords('same sentence.','same sentence.'),{removed:[],added:[]})
    assert.equal(prose.sentences.length,1)
    assert.ok(prose.sentences[0].parts.some(p=>p.kind==='same'&&p.text.includes('dress stays')))
    assert.ok(prose.sentences[0].parts.some(p=>p.kind==='add'&&p.text.includes('hair')))
    for(const [a,b] of [['Text: 来了，来了','Text: 等一下'],['The heart pupil is a heart.','The star pupil is a star.'],['','A new sentence.'],['A deleted sentence.',''],['x '.repeat(2000),'y '.repeat(2000)]]) {
      const parts=wordParts(a,b)
      assert.equal(parts.filter(p=>p.kind!=='add').map(p=>p.text).join(''),a)
      assert.equal(parts.filter(p=>p.kind!=='remove').map(p=>p.text).join(''),b)
    }

    console.log('PASS MCP guide, masks/previews, image plans, infill, metadata defaults, pixel preservation, validation, permission gates and tag diffs; no real API calls')
  } catch(e){console.error(e);process.exitCode=1} finally{app.exit(process.exitCode||0)}
})
