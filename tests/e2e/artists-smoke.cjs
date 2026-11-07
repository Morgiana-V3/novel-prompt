// Offline artist studio: fixed comparison requests, result provenance and saved drafts.
const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
const { app, BrowserWindow, ipcMain, net } = require('electron')
const { join, resolve } = require('node:path')
const { writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const profile = temporaryProfile('np-artists-smoke-')
app.disableHardwareAcceleration()
const artifacts = artifactDirectory(profile)
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(__dirname, '../../out'))
app.setPath('userData', profile)
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const requests = []
let rejectGeneration = false
let generationDelay = 100
const settings = {
  naiToken: 'offline-fixture',
  naiVersion: 'v5',
  baseUrl: '',
  model: '',
  visionModel: '',
  visionBaseUrl: '',
  visionApiKey: '',
}
const catalogQueries = []
const fixtureArtists = [
  'wlop',
  'mika pikazo',
  'anmi',
  'kantoku',
  'wanke',
  'yoneyama mai',
  ...Array.from({ length: 24 }, (_, index) => `test artist ${index}`),
]
let rejectCatalog = false
const galleryImages = []
const galleryRecipe = {
  schema: 1,
  createdAt: 1,
  sourceKind: 'generate',
  request: {
    version: 'v4.5',
    base: 'artist:anmi, forest, fog',
    negative: 'lowres',
    characters: [],
    params: {
      width: 640,
      height: 896,
      steps: 25,
      scale: 4,
      cfgRescale: 0,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'native',
      seed: 98765,
      count: 1,
      qualityTags: false,
      ucPreset: 'light',
    },
  },
}
net.fetch = async () => {
  throw new Error('Unexpected provider request in offline regression')
}
const handlers = {
  'window:image-preview': () => undefined,
  'artists:catalog': async (_, query) => {
    catalogQueries.push(query)
    if (process.env.NP_TEST_ARTIST_PREVIEWS) {
      require('../support/register-typescript.cjs')
      return require('../../src/main/modules/artists/catalog.ts').queryArtistCatalog(query)
    }
    await pause(query.query === 'slow' ? 700 : 80)
    if (rejectCatalog) {
      throw new Error('catalog fixture failure')
    }
    const names = fixtureArtists.filter(
      (name) =>
        name.includes(query.query.toLowerCase()) &&
        (!query.favorites || query.favorites.includes(name)),
    )
    return {
      entries: names.slice((query.page - 1) * 24, query.page * 24).map((name) => ({
        id: name,
        name,
        title: name,
        tags: `artist:${name}`,
        source: '离线测试夹具',
        image: 'https://assets.quicktagcloud.com/images/test-fixture.jpg',
      })),
      total: names.length,
      page: query.page,
      pageSize: 24,
      version: query.version,
      updated: 'fixture',
    }
  },
  'storage:info': () => ({ path: profile, bytes: 0 }),
  'collections:list': () => [{ id: 'default', name: '默认图集', createdAt: 0 }],
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'settings:get': () => settings,
  'settings:save': (_, patch) => Object.assign(settings, patch),
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
  'recipes:list': () => [],
  'pages:list': () => [],
  'db:status': () => ({
    loaded: true,
    tagCount: 0,
    aliasCount: 0,
    zhCount: 0,
    implicationCount: 0,
  }),
  'nai:list': () => galleryImages,
  'nai:recipe': async (_, name) => {
    await pause(name === 'slow.png' ? 400 : 40)
    return name === 'missing.png' ? null : galleryRecipe
  },
  'nai:subscription': () => ({ active: true, tier: 3, anlasFixed: 10000, anlasPurchased: 0 }),
  'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
  'tag:complete': () => [],
  'prompt:analyze': () => ({ tokens: [], stats: {} }),
  'nai:generate': async (_, request) => {
    requests.push(request)
    await pause(generationDelay)
    if (rejectGeneration) {
      throw new Error('offline fixture failure')
    }
    return {
      images: [
        {
          name: `offline-${requests.length}.png`,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          createdAt: Date.now(),
          seed: request.params.seed,
        },
      ],
      anlasDelta: 0,
    }
  },
}
for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, handler)
}
app.whenReady().then(async () => {
  let win
  try {
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      webPreferences: {
        preload: join(buildDirectory, 'preload/index.js'),
        sandbox: false,
        offscreen: true,
        backgroundThrottling: false,
      },
    })
    const js = (expression) => win.webContents.executeJavaScript(expression, true)
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        console.error('Renderer: ' + event.message)
      }
    })
    if (!process.env.NP_TEST_ARTIST_PREVIEWS) {
      win.webContents.session.webRequest.onBeforeRequest(
        { urls: ['https://assets.quicktagcloud.com/*'] },
        (_details, callback) => callback({ cancel: true }),
      )
    }
    const wait = async (expression) => {
      for (let index = 0; index < 200; index++) {
        if (await js(expression)) {
          return
        }
        await pause(30)
      }
      throw new Error('Timed out: ' + expression)
    }
    const click = async (text) => {
      await js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled&&e.getClientRects().length&&(!e.closest('dialog')||e.closest('dialog').open));if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.click()})()`,
      )
      await pause(70)
    }
    const input = async (selector, value, event = 'input') => {
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`,
      )
      await pause(60)
    }
    if (process.env.NP_TEST_RENDERER_URL) {
      await win.loadURL(process.env.NP_TEST_RENDERER_URL)
    } else {
      await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    }
    await wait(`!!document.querySelector('.nav-item')`)
    const navigate = async () => {
      await js(
        `[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('画师调试')).click()`,
      )
      await wait(`document.querySelector('.artist-studio').getBoundingClientRect().width > 0`)
    }
    await navigate()
    if (process.env.NP_TEST_ARTIST_PREVIEWS) {
      await click('画师图鉴')
      await wait(`document.querySelectorAll('.catalog-preview img').length===24`)
      await wait(
        `[...document.querySelectorAll('.catalog-preview img')].slice(0,3).every(image=>image.complete&&image.naturalWidth>0)`,
      )
      await js(
        `Promise.all([...document.querySelectorAll('.catalog-preview img')].slice(0,3).map(image=>image.decode()))`,
      )
      await pause(300)
      writeFileSync(
        join(artifacts, 'artists-catalog-live.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      await js(`document.querySelector('.catalog-preview').click()`)
      await wait(`!!document.querySelector('.catalog-lightbox img')`)
      writeFileSync(
        join(artifacts, 'artist-reference-live.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      console.log(
        'PASS live public catalog loaded; no generation provider requests. Screenshots: ' +
          artifacts,
      )
      app.exit(0)
      return
    }
    // Migrate the previous crowded dropdown without losing its selected draft or snapshots.
    await js(`(()=>{
      const artists=['wlop','rella','mika pikazo'].map((name,index)=>({id:'legacy-'+index,name,weight:[0.8,0.6,0.4][index],enabled:true,locked:false}));
      const current=JSON.parse(JSON.stringify(artists));current[1].weight=0.4;
      const context={base:'1girl, solo, upper body, looking at viewer, simple background',negative:'',characters:[],version:'v5',params:{seed:123456789,count:1,width:832,height:1216,steps:23,scale:5,sampler:'k_euler_ancestral',qualityTags:true,ucPreset:0}};
      localStorage.setItem('np-artist-studio-v1-v5',JSON.stringify({baseline:{id:'baseline',name:'旧基准',artists},schemes:Array.from({length:20},(_,index)=>({id:'old-'+index,name:'旧稿'+index,artists:current})),selectedId:'old-19',context,customContent:null,favoriteArtists:[]}));
    })()`)
    await win.webContents.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await navigate()
    assert.equal(await js(`document.querySelector('#artist-scheme-select')`), null)
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '0.4')
    const originalArchive = await js(
      `JSON.stringify(JSON.parse(localStorage.getItem('np-artist-studio-v1-v5')).schemes)`,
    )
    await js(`document.querySelector('[aria-label="调整固定种子"]').click()`)
    assert.equal(await js(`document.querySelectorAll('.artist-seed-dialog input').length`), 1)
    win.setContentSize(1100, 640)
    await pause(150)
    await js(`document.querySelector('.artist-seed-dialog .artist-dialog-body').scrollTop=10000`)
    assert.ok(
      await js(
        `(()=>{const d=document.querySelector('.artist-seed-dialog');const r=d.querySelector('footer').getBoundingClientRect();const h=d.querySelector('header').getBoundingClientRect();return h.top>=0&&r.bottom<=innerHeight&&getComputedStyle(d).overflow==='hidden'})()`,
      ),
    )
    writeFileSync(
      join(artifacts, 'artist-parameters.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 3, y: 3, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 3, y: 3, button: 'left', clickCount: 1 })
    await wait(`!document.querySelector('.artist-seed-dialog').open`)
    win.setContentSize(1440, 960)
    await click('画师图鉴')
    await wait(`document.querySelector('.artist-catalog-dialog').open`)
    await wait(`document.querySelectorAll('.catalog-card').length===24`)
    rejectCatalog = true
    await js(`document.querySelector('.catalog-scroll').scrollTop=10000`)
    await wait(`!!document.querySelector('.catalog-empty[role="alert"]')`)
    assert.equal(
      await js(`document.querySelectorAll('.catalog-card').length`),
      24,
      'failed append preserves the loaded cards',
    )
    rejectCatalog = false
    await click('重试加载更多')
    await wait(`document.querySelectorAll('.catalog-card').length===30`)
    assert.equal(
      new Set(
        await js(
          `[...document.querySelectorAll('.catalog-card-title strong')].map(e=>e.textContent)`,
        ),
      ).size,
      30,
    )
    assert.ok(
      await js(
        `(()=>{const d=document.querySelector('.artist-catalog-dialog');const h=d.querySelector('header').getBoundingClientRect();const f=d.querySelector('footer').getBoundingClientRect();return h.top>=0&&f.bottom<=innerHeight&&getComputedStyle(d).overflow==='hidden'})()`,
      ),
    )
    writeFileSync(
      join(artifacts, 'artist-catalog-scroll.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 3, y: 3, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 3, y: 3, button: 'left', clickCount: 1 })
    await wait(`!document.querySelector('.artist-catalog-dialog').open`)
    await click('画师图鉴')
    await wait(`document.querySelectorAll('.catalog-card').length===24`)
    await input('[aria-label="搜索图鉴画师"]', 'slow')
    await pause(300)
    await input('[aria-label="搜索图鉴画师"]', 'anmi')
    await pause(800)
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    await js(`document.querySelector('[aria-label="收藏 anmi"]').click()`)
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    await click('加入画师串')
    assert.equal(await js(`document.querySelector('.catalog-add').disabled`), true)
    await input('[aria-label="搜索图鉴画师"]', '')
    await js(`document.querySelector('[aria-label="查看图鉴收藏"]').click()`)
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    await click('返回调试')
    assert.ok(await js(`!!document.querySelector('[aria-label="anmi 权重"]')`))
    assert.ok(
      await js(`document.querySelector('[aria-label="打开图鉴收藏"]').textContent.includes('1')`),
    )
    await js(`document.querySelector('[aria-label="打开图鉴收藏"]').click()`)
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    assert.equal(
      await js(
        `document.querySelector('[aria-label="查看图鉴收藏"]').getAttribute('aria-pressed')`,
      ),
      'true',
    )
    await js(`document.querySelector('[aria-label="收藏 anmi"]').click()`)
    await wait(`document.querySelectorAll('.catalog-card').length===0`)
    assert.ok(
      await js(`document.querySelector('[aria-label="打开图鉴收藏"]').textContent.includes('0')`),
    )
    await click('全部画师')
    await input('[aria-label="搜索图鉴画师"]', 'anmi')
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    await js(`document.querySelector('[aria-label="收藏 anmi"]').click()`)
    await click('返回调试')
    for (const width of [1440, 1100]) {
      win.setContentSize(width, 960)
      await pause(250)
      assert.ok(
        await js(
          `(()=>{const r=document.querySelector('.artist-run-actions').getBoundingClientRect();const h=document.querySelector('.artist-footer').getBoundingClientRect();return r.top>=h.top&&r.bottom<=h.bottom&&h.bottom<=innerHeight&&h.height===54})()`,
        ),
        `generation action stays visible at ${width}`,
      )
      assert.ok(
        await js(
          `(()=>{const e=document.querySelector('.artist-studio');return e.scrollWidth<=e.clientWidth})()`,
        ),
        `no horizontal overflow at ${width}`,
      )
      assert.ok(
        await js(
          `(()=>{const pair=document.querySelector('.artist-image-pair').getBoundingClientRect();const footer=document.querySelector('.artist-footer').getBoundingClientRect();return pair.height>500&&footer.top-pair.bottom>=0&&footer.top-pair.bottom<24})()`,
        ),
        'comparison images fill the space above the shared-style footer',
      )
      writeFileSync(
        join(artifacts, `artists-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      )
    }
    const beforeDuplicateArtist = await js(`document.querySelectorAll('.artist-entry').length`)
    await input('[aria-label="添加画师"]', 'mika_pikazo')
    await js(`document.querySelector('.artist-add').requestSubmit()`)
    await pause(70)
    assert.equal(
      await js(`document.querySelectorAll('.artist-entry').length`),
      beforeDuplicateArtist,
      'underscores and spaces must not create duplicate artists',
    )
    await click('粘贴画师串')
    await input('[aria-label="画师串原文"]', '0.8::artist:wlop::, 1.2::artist:rella::')
    await click('替换当前画师串')
    assert.equal(await js(`document.querySelectorAll('.artist-entry').length`), 2)
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '1.2')
    // Delete is distinct from disabling. Adding the same artist again remains possible.
    await js(`document.querySelector('[aria-label="删除画师 rella"]').click()`)
    await wait(`!document.querySelector('[aria-label="rella 权重"]')`)
    await input('[aria-label="添加画师"]', 'rella')
    await js(`document.querySelector('.artist-add').requestSubmit()`)
    await wait(`!!document.querySelector('[aria-label="rella 权重"]')`)
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '1')
    const sliderBounds = async () => {
      const bounds = await js(
        `[...document.querySelectorAll('.artist-weight-row input[type="range"]')].map(e=>[e.min,e.max,e.step])`,
      )
      assert.ok(bounds.length > 1)
      for (const bound of bounds) {
        assert.deepEqual(bound, bounds[0], 'all artists share the same scale')
      }
      return bounds[0]
    }
    assert.deepEqual(await sliderBounds(), ['0', '2', '0.05'])
    await input('[aria-label="画师滑杆上限"]', '10', 'change')
    assert.deepEqual(await sliderBounds(), ['0', '10', '0.05'])
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '1')
    await input('[aria-label="画师滑杆上限"]', '2', 'change')
    await input('[aria-label="rella 权重"]', '3.25', 'change')
    assert.deepEqual(await sliderBounds(), ['0', '4', '0.05'])
    await input('[aria-label="画师滑杆上限"]', '2', 'change')
    assert.equal(await js(`document.querySelector('[aria-label="画师滑杆上限"]').value`), '4')
    assert.equal(
      await js(`document.querySelector('[aria-label="rella 权重"]').value`),
      '3.25',
      'rejecting a smaller scale must not clamp a weight',
    )
    await input('[aria-label="画师滑杆上限"]', '', 'change')
    assert.equal(await js(`document.querySelector('[aria-label="画师滑杆上限"]').value`), '4')

    for (const weight of ['2.5', '1.5', '0.5']) {
      await input('[aria-label="rella 权重滑杆"]', weight)
      assert.deepEqual(
        await sliderBounds(),
        ['0', '4', '0.05'],
        'dragging back keeps the upper bound',
      )
      assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), weight)
    }
    await input('[aria-label="rella 权重"]', '-1.25', 'change')
    assert.deepEqual(await sliderBounds(), ['-2', '4', '0.05'])
    await input('[aria-label="rella 权重滑杆"]', '-0.5')
    assert.deepEqual(
      await sliderBounds(),
      ['-2', '4', '0.05'],
      'dragging back keeps the lower bound',
    )
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '-0.5')
    assert.equal(
      await js(`document.querySelector('[aria-label="wlop 权重"]').value`),
      '0.8',
      'other artist weights are not normalized',
    )
    await input('[aria-label="rella 权重"]', '1.2', 'change')
    const comparisonLayout = () =>
      js(
        `(()=>{const pair=document.querySelector('.artist-image-pair').getBoundingClientRect();const footer=document.querySelector('.artist-footer').getBoundingClientRect();return [pair.top,pair.height,footer.top,footer.height]})()`,
      )
    const idleLayout = await comparisonLayout()
    generationDelay = 500
    await click('生成对照')
    await wait(
      `[...document.querySelectorAll('.artist-footer button')].some(e=>e.textContent.trim()==='停止试图')`,
    )
    assert.equal(
      await js(`document.querySelector('.artist-run-status')`),
      null,
      'generation progress does not insert a footer row',
    )
    assert.deepEqual(
      await comparisonLayout(),
      idleLayout,
      'generation does not compress the comparison layout',
    )
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    generationDelay = 100
    assert.deepEqual(await comparisonLayout(), idleLayout, 'completion keeps the same layout')
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0].params, requests[1].params)
    assert.equal(requests[0].params.seed, 123456789)
    assert.equal(requests[0].params.count, 1)
    assert.ok(requests[0].base.includes('artist:wlop'), 'legacy baseline keeps its artist string')
    assert.equal(requests[0].negative, requests[1].negative)
    assert.deepEqual(requests[0].characters, requests[1].characters)
    assert.ok(requests[1].base.includes('1.2::artist:rella::'))
    const beforeScale = await js(
      `(()=>{const s=JSON.parse(localStorage.getItem('np-artist-studio-v1-v5'));return JSON.stringify([s.context,s.baseline,s.draft])})()`,
    )
    await input('[aria-label="画师滑杆上限"]', '7', 'change')
    assert.equal(
      await js(
        `(()=>{const s=JSON.parse(localStorage.getItem('np-artist-studio-v1-v5'));return JSON.stringify([s.context,s.baseline,s.draft])})()`,
      ),
      beforeScale,
    )
    assert.equal(
      await js(`document.querySelectorAll('.artist-pick').length`),
      2,
      'scale changes preserve valid comparison results',
    )
    await pause(100)
    writeFileSync(
      join(artifacts, 'artist-shared-weight-range.png'),
      (await win.webContents.capturePage()).toPNG(),
    )

    const beforePreview = await js(`localStorage.getItem('np-artist-studio-v1-v5')`)
    for (const label of ['放大基准图', '放大候选图']) {
      await js(`document.querySelector('[aria-label="${label}"]').click()`)
      await wait(`!!document.querySelector('.image-viewer')`)
      assert.equal(
        await js(`localStorage.getItem('np-artist-studio-v1-v5')`),
        beforePreview,
        'preview must not choose a winner or change the draft',
      )
      await js(
        `document.querySelector('.image-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      )
      await wait(`!document.querySelector('.image-viewer')`)
    }
    // An edited draft must not be accepted using its previous image.
    await input('[aria-label="rella 权重"]', '1.1', 'change')
    assert.equal(await js(`document.querySelectorAll('.artist-pick').length`), 0)
    await input('[aria-label="rella 权重"]', '1.2', 'change')
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await wait(`document.querySelectorAll('.artist-generated').length===1`)
    assert.equal(
      await js(`document.querySelector('[aria-label="放大基准图"]').disabled`),
      false,
      'preview stays available after a winner is selected',
    )
    const baselineName = await js(
      `JSON.parse(localStorage.getItem('np-artist-studio-v1-v5')).baseline.artists.map(a=>a.name)`,
    )
    assert.deepEqual(baselineName, ['wlop', 'rella'])
    await input('[aria-label="rella 权重"]', '0.6', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, 3, 'the accepted baseline is reused')
    await js(`document.querySelector('[aria-label="选基准图"]').click()`)
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='1.2'`)
    await input('[aria-label="rella 权重"]', '0.7', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, 4)
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await wait(`document.querySelectorAll('.artist-generated').length===1`)
    await input('[aria-label="rella 权重"]', '0.9', 'change')
    rejectGeneration = true
    await click('生成对照')
    await wait(
      `document.querySelector('.artist-error')?.textContent.includes('offline fixture failure')`,
    )
    assert.equal(requests.length, 5)
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 1)
    assert.equal(await js(`document.querySelectorAll('.artist-pick').length`), 0)
    rejectGeneration = false
    await js(`document.querySelector('[aria-label="调整固定种子"]').click()`)
    await input('.artist-seed-field input', '')
    await click('完成')
    await click('生成对照')
    assert.equal(requests.length, 5, 'blank seed must not randomize comparison')
    await js(`document.querySelector('[aria-label="调整固定种子"]').click()`)
    await input('.artist-seed-field input', '123456789')
    await click('完成')
    await click('V4.5')
    await wait(
      `JSON.parse(localStorage.getItem('np-artist-studio-v1-v4.5') || 'null')?.context.version==='v4.5'`,
    )
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 0)
    await input('[aria-label="rella 权重"]', '1.6', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, 7)
    assert.equal(requests[5].version, 'v4.5')
    assert.equal(requests[6].version, 'v4.5')
    assert.ok(
      requests[5].base.includes('0.7::artist:rella::'),
      'changing models keeps the baseline artist string',
    )
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='1.6'`)
    await click('画师图鉴')
    await wait(`document.querySelectorAll('.catalog-card').length>0`)
    assert.equal(catalogQueries.at(-1).version, 'v4.5')
    await click('返回调试')
    await click('V5')
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='0.9'`)
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 1)
    await click('V4.5')
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='1.6'`)
    await click('V5')
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='0.9'`)
    await win.webContents.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await navigate()
    assert.equal(await js(`document.querySelector('[aria-label="rella 权重"]').value`), '0.9')
    await click('画师图鉴')
    await wait(`document.querySelectorAll('.catalog-card').length===24`)
    await js(`document.querySelector('[aria-label="查看图鉴收藏"]').click()`)
    await wait(`document.querySelectorAll('.catalog-card').length===1`)
    await click('返回调试')
    rejectCatalog = true
    await click('画师图鉴')
    await wait(
      `document.querySelector('.catalog-empty[role="alert"]')?.textContent.includes('catalog fixture failure')`,
    )
    rejectCatalog = false
    await click('重新加载图鉴')
    await wait(`document.querySelectorAll('.catalog-card').length===24`)
    await click('返回调试')
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 1)
    assert.equal(
      await js(`document.querySelector('[aria-label="画师滑杆上限"]').value`),
      '7',
      'shared scale persists across model switching and reload',
    )
    // The chosen baseline survives reload; only the edited candidate needs generating.
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await js(`[...document.querySelectorAll('.artist-delete')].forEach(button=>button.click())`)
    await wait(`document.querySelectorAll('.artist-entry').length===0`)
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(
      await js(`document.querySelectorAll('.artist-generated').length`),
      2,
      'removing all artists is still a valid candidate',
    )
    await js(`document.querySelector('[aria-label="选基准图"]').click()`)
    await wait(`document.querySelectorAll('.artist-entry').length===2`)
    const savedDraft = await js(`JSON.parse(localStorage.getItem('np-artist-studio-v1-v5'))`)
    assert.equal(
      JSON.stringify(savedDraft.schemes),
      originalArchive,
      'iterations must neither append to nor mutate the legacy archive',
    )
    assert.equal(savedDraft.draft.artists.length, 2)
    await js(`document.querySelector('.artist-legacy summary').click()`)
    await js(`document.querySelector('[aria-label="载入旧版画师串 旧稿19"]').click()`)
    await wait(`document.querySelector('[aria-label="rella 权重"]').value==='0.4'`)
    assert.equal(await js(`document.querySelectorAll('.artist-entry').length`), 3)

    // A fresh studio takes the creation snapshot, strips positive artist tags only,
    // and returns the chosen string through the existing undoable prompt workflow.
    const creation = {
      prompt: '{artist:wlop, red sky}, 1.2::artist:rella, city::',
      negative: 'artist:unwanted, lowres',
      characters: [{ prompt: '1girl, black hair', negative: 'hat', position: 'A1' }],
      params: { width: 768, height: 1024, qualityTags: false, ucPreset: 'light' },
    }
    await js(
      `localStorage.setItem('np-creation-tabs-v1', ${JSON.stringify(
        JSON.stringify({
          activeId: 'active-other',
          tabs: [
            { id: 'active-other', title: '其他内容', content: null },
            {
              id: 'chosen-tab',
              title: '夜景',
              content: {
                ...creation,
                history: [],
                gen: {
                  steps: 23,
                  scale: 5,
                  sampler: 'k_euler_ancestral',
                  noiseSchedule: 'native',
                  seed: 123456789,
                  count: 1,
                },
              },
            },
          ],
        }),
      )});localStorage.setItem('np-workspace-v1', ${JSON.stringify(JSON.stringify({ ...creation, prompt: 'ocean, sailboat' }))}); localStorage.removeItem('np-artist-studio-v1-v5'); localStorage.removeItem('np-artist-studio-v1');`,
    )
    await win.webContents.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await navigate()
    assert.equal(
      await js(`document.querySelectorAll('.artist-entry').length`),
      0,
      'must not implicitly import the active tab',
    )
    await click('选择蓝本')
    await click('创作标签')
    await js(
      `[...document.querySelectorAll('.blueprint-tabs button')].find(e=>e.textContent.includes('夜景')).click()`,
    )
    await pause(250)
    writeFileSync(
      join(artifacts, 'artist-blueprint-tabs.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await click('使用此蓝本')
    assert.equal(
      await js(`document.querySelector('#creation-editor [aria-label="主提示词"]').value`),
      'ocean, sailboat',
      'selecting another tab must not switch the editor',
    )
    await wait(`document.querySelector('[aria-label="rella 权重"]')?.value==='1.2'`)
    assert.ok(
      await js(
        `[...document.querySelectorAll('.artist-content-source button')].some(e=>e.title.includes('夜景'))`,
      ),
    )
    assert.equal(
      await js(`document.querySelector('.artist-image-card header strong').textContent`),
      '当前基准',
    )
    const creationStart = requests.length
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-generated').length===1`)
    assert.equal(requests.length, creationStart + 1)
    assert.equal(
      requests[creationStart].base,
      '1.05::artist:wlop::, 1.2::artist:rella::, {red sky}, 1.2::city::',
    )
    assert.equal(requests[creationStart].negative, creation.negative)
    assert.deepEqual(requests[creationStart].characters, creation.characters)
    assert.equal(requests[creationStart].params.width, 768)
    assert.equal(requests[creationStart].params.qualityTags, false)
    assert.equal(
      await js(`document.querySelectorAll('.artist-image-card > .artist-pick').length`),
      0,
      'no full-width footer choices',
    )
    win.setContentSize(1440, 960)
    await pause(200)
    writeFileSync(
      join(artifacts, 'artists-comparison.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await input('[aria-label="rella 权重"]', '0.7', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, creationStart + 2, 'subsequent runs reuse the selected baseline')
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await click('编辑来源')
    await input('#creation-editor [aria-label="主提示词"]', creation.prompt + ', rain')
    await navigate()
    await wait(`document.querySelector('.artist-content-update')?.textContent.includes('更新蓝本')`)
    const frozen = await js(`JSON.parse(localStorage.getItem('np-artist-studio-v1-v5'))`)
    assert.equal(
      frozen.context.base,
      '{red sky}, 1.2::city::',
      'editing creation must not silently change a comparison',
    )
    await click('更新蓝本')
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 0)
    assert.equal(
      await js(`document.querySelector('[aria-label="rella 权重"]').value`),
      '1.2',
      'reloading a blueprint takes its artist string',
    )
    assert.equal(
      await js(`document.querySelector('.artist-image-card header strong').textContent`),
      '当前基准',
    )
    await input('[aria-label="rella 权重"]', '0.7', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(
      requests.at(-2).base,
      '1.05::artist:wlop::, 1.2::artist:rella::, {red sky}, 1.2::city::, rain',
    )
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await click('带回来源标签')
    await wait(`document.querySelector('#creation-editor').getBoundingClientRect().width > 0`)
    assert.equal(
      await js(`document.querySelector('#creation-editor [aria-label="主提示词"]').value`),
      '1.05::artist:wlop::, 0.7::artist:rella::, {red sky}, 1.2::city::, rain',
    )
    await pause(350)
    const applied = await js(`JSON.parse(localStorage.getItem('np-workspace-v1'))`)
    assert.equal(applied.negative, creation.negative)
    assert.deepEqual(applied.characters, creation.characters)
    assert.equal(applied.history[0].base, creation.prompt + ', rain')
    await js(`document.querySelector('.toast-action').click()`)
    assert.equal(
      await js(`document.querySelector('#creation-editor [aria-label="主提示词"]').value`),
      creation.prompt + ', rain',
    )
    // The selected original image and its artist string are the initial baseline.
    const imageUrl =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="896"><rect x="80" y="100" width="480" height="696" rx="40" fill="#d4b9cf"/></svg>',
      )
    galleryImages.push(
      ...['slow.png', 'missing.png', 'scene.png'].map((name, index) => ({
        name,
        url: imageUrl,
        createdAt: 10 - index,
      })),
    )
    await navigate()
    await click('更换蓝本')
    await click('图库图片')
    await wait(`document.querySelectorAll('.blueprint-images button').length===3`)
    await js(
      `document.querySelector('[aria-label="选择蓝本图片 slow.png"]').click();document.querySelector('[aria-label="选择蓝本图片 missing.png"]').click()`,
    )
    await pause(500)
    await wait(`document.querySelector('.blueprint-error')?.textContent.includes('未保存提示词')`)
    assert.equal(
      await js(`document.querySelector('.blueprint-dialog footer button').disabled`),
      true,
      'a stale successful recipe must not replace the selected missing recipe',
    )
    await js(`document.querySelector('[aria-label="选择蓝本图片 scene.png"]').click()`)
    await wait(`!!document.querySelector('.blueprint-preview')`)
    await pause(200)
    writeFileSync(
      join(artifacts, 'artist-blueprint-gallery.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await click('使用此蓝本')
    assert.ok(
      await js(`!document.querySelector('.artist-toolbar').textContent.includes('scene.png')`),
    )
    assert.equal(await js(`document.querySelectorAll('.artist-generated').length`), 1)
    assert.equal(
      await js(`document.querySelector('.artist-image-card img').getAttribute('src')`),
      imageUrl,
    )
    assert.equal(await js(`document.querySelector('[aria-label="anmi 权重"]').value`), '1')
    assert.equal(
      await js(`document.querySelectorAll('.artist-entry').length`),
      1,
      'switching blueprints replaces old artists',
    )
    assert.ok(
      await js(
        `document.querySelector('.artist-comparison .artist-section-heading').textContent.includes('蓝本 V4.5')`,
      ),
      'different source model is labeled explicitly',
    )
    assert.equal(
      await js(`document.querySelector('.artist-changes')`),
      null,
      'no empty change section',
    )
    assert.ok(await js(`!!document.querySelector('.artist-run-actions button')`))
    const hoverPoint = await js(
      `(()=>{const r=document.querySelector('.artist-generated').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
    await pause(100)
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.artist-generated')).outlineStyle`),
      'none',
      'hover must not outline the image',
    )
    const galleryStart = requests.length
    assert.equal(
      await js(
        `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='生成对照').disabled`,
      ),
      true,
      'importing a blueprint does not regenerate it',
    )
    await pause(200)
    writeFileSync(
      join(artifacts, 'artist-blueprint-baseline.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await input('[aria-label="anmi 权重"]', '1.3', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, galleryStart + 1, 'only the adjusted candidate is generated')
    assert.equal(requests.at(-1).base, '1.3::artist:anmi::, forest, fog')
    assert.equal(requests.at(-1).params.seed, 98765)
    assert.equal(requests.at(-1).params.width, 640)
    assert.equal(
      requests.at(-1).version,
      'v5',
      'gallery reference must not silently switch the sidebar model',
    )
    await js(`document.querySelector('[aria-label="选基准图"]').click()`)
    await wait(`document.querySelector('[aria-label="anmi 权重"]').value==='1'`)
    assert.equal(
      await js(`document.querySelector('.artist-image-card img').getAttribute('src')`),
      imageUrl,
    )
    await win.webContents.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await navigate()
    await wait(`!!document.querySelector('.artist-image-card img')`)
    assert.equal(
      await js(`document.querySelector('.artist-image-card img').getAttribute('src')`),
      imageUrl,
      'blueprint mapping survives reload',
    )
    await input('[aria-label="anmi 权重"]', '1.4', 'change')
    await click('生成对照')
    await wait(`document.querySelectorAll('.artist-pick').length===2`)
    assert.equal(requests.length, galleryStart + 2)
    await js(`document.querySelector('[aria-label="选新图"]').click()`)
    await wait(`document.querySelectorAll('.artist-generated').length===1`)
    assert.notEqual(
      await js(`document.querySelector('.artist-image-card img').getAttribute('src')`),
      imageUrl,
      'choosing the candidate replaces the original image baseline',
    )
    await click('在创作页打开')
    await wait(
      `document.querySelector('#creation-editor [aria-label="主提示词"]').value.includes('forest, fog')`,
    )
    assert.equal(
      await js(`JSON.parse(localStorage.getItem('np-creation-tabs-v1')).tabs.length`),
      3,
      'gallery result opens a new creation tab',
    )
    const tabsAfterGallery = await js(`JSON.parse(localStorage.getItem('np-creation-tabs-v1'))`)
    assert.equal(
      tabsAfterGallery.tabs.find((tab) => tab.id === 'active-other').content.prompt,
      'ocean, sailboat',
    )
    assert.equal(
      tabsAfterGallery.tabs.find((tab) => tab.id === 'chosen-tab').content.prompt,
      creation.prompt + ', rain',
    )
    console.log(
      'PASS artist studio: infinite catalog scrolling, pinned modal controls and backdrop dismissal, explicit named-tab blueprints, content isolation, undo, delete, winner selection, baseline reuse, model isolation and persistence. No generation provider requests.',
    )
    console.log('Screenshots: ' + artifacts)
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (win) {
      console.error(
        await win.webContents.executeJavaScript('document.body.innerText').catch(() => ''),
      )
    }
    app.exit(1)
  }
})
