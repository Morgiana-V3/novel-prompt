const { app, BrowserWindow, ipcMain, protocol, dialog } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join } = require('node:path')
const { PNG } = require('pngjs')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-favorites-')
app.setPath('userData', profile)
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  { scheme: 'np-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
require('../support/register-typescript.cjs')
const library = require('../../src/main/modules/images/library.ts')
const recipes = require('../../src/main/modules/images/recipes.ts')
const { readPngRecipe, embedRecipe } = require('../../src/main/modules/images/png-record.ts')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
const params = {
  width: 64,
  height: 64,
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 123,
  count: 1,
  qualityTags: false,
  ucPreset: 'none',
}
const record = (base, seed) => ({
  schema: 1,
  createdAt: 123456,
  sourceKind: 'generate',
  request: {
    base,
    negative: 'blurry',
    characters: [{ prompt: 'blue hair', negative: 'hat', position: 'A1' }],
    version: 'v5',
    params: { ...params, seed },
  },
})
const png = new PNG({ width: 64, height: 64 })
png.data.fill(210)
const bytes = PNG.sync.write(png)
// Upgrade fixture: v0.8 generated PNG + adjacent request JSON, without embedded metadata.
const oldName = require('node:crypto').randomUUID() + '.png'
const oldPath = join(library.legacyImageDir(), oldName)
fs.writeFileSync(oldPath, bytes)
fs.writeFileSync(oldPath + '.json', JSON.stringify(record('v0.8 image', 321)))
assert.deepEqual(library.readImageRecipe(oldName), record('v0.8 image', 321))
assert.deepEqual(
  fs.readFileSync(oldPath),
  bytes,
  'reading legacy metadata leaves original bytes untouched',
)
assert.deepEqual(readPngRecipe(library.imageBytesWithRecipe(oldName)), record('v0.8 image', 321))
const upgradedFavorite = recipes.createRecipe(oldName)
assert.deepEqual(
  readPngRecipe(fs.readFileSync(recipes.favoriteImagePath(upgradedFavorite.id))),
  record('v0.8 image', 321),
)
const upgradedCopy = library.ownWorkspaceImage(oldName, require('node:crypto').randomUUID())
assert.deepEqual(
  readPngRecipe(fs.readFileSync(library.libraryImagePath(upgradedCopy.name))),
  record('v0.8 image', 321),
)
fs.writeFileSync(oldPath + '.json', '{}')
assert.throws(() => library.readImageRecipe(oldName), /旧版图片生成记录损坏/)
// Provider metadata contains the expanded prompt; the v0.8 sidecar is the exact user request.
const comment = Buffer.from(
  'Comment\0' +
    JSON.stringify({
      prompt: 'expanded quality tags, v0.8 image',
      uc: 'expanded negative',
      model_name: 'nai-diffusion-5',
      width: 64,
      height: 64,
      steps: 23,
      scale: 5,
      cfg_rescale: 0,
      sampler: 'k_euler',
      noise_schedule: 'native',
      seed: 321,
    }),
)
const chunk = Buffer.alloc(comment.length + 12)
chunk.writeUInt32BE(comment.length)
chunk.write('tEXt', 4)
comment.copy(chunk, 8)
chunk.writeUInt32BE(require('node:zlib').crc32(chunk.subarray(4, -4)), chunk.length - 4)
const providerPng = Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)])
assert.equal(readPngRecipe(providerPng).request.base, 'expanded quality tags, v0.8 image')
fs.writeFileSync(oldPath, providerPng)
fs.writeFileSync(oldPath + '.json', JSON.stringify(record('v0.8 image', 321)))
assert.deepEqual(library.readImageRecipe(oldName), record('v0.8 image', 321))
assert.deepEqual(readPngRecipe(library.imageBytesWithRecipe(oldName)), record('v0.8 image', 321))
fs.writeFileSync(oldPath, embedRecipe(providerPng, record('embedded exact request', 654)))
assert.deepEqual(library.readImageRecipe(oldName), record('embedded exact request', 654))
recipes.deleteRecipe(upgradedFavorite.id)
fs.unlinkSync(library.libraryImagePath(upgradedCopy.name))
fs.unlinkSync(oldPath)
fs.unlinkSync(oldPath + '.json')
saveSettings({ naiVersion: 'v5' })
const first = library.storeGeneratedImage(bytes, record('cat, watercolor', 123), 'temporary')
const second = library.storeGeneratedImage(bytes, record('dog, outdoors', 456), 'saved')
const saved = recipes.createRecipe(first.name)
assert.equal(
  saved.contentHash,
  first.contentHash,
  'source and favorite share their content identity',
)
assert.equal(recipes.createRecipe(first.name).id, saved.id, 'repeat stars do not duplicate records')
assert.ok(recipes.favoriteImagePath(saved.id))
assert.deepEqual(
  readPngRecipe(fs.readFileSync(recipes.favoriteImagePath(saved.id))),
  record('cat, watercolor', 123),
)
fs.unlinkSync(library.libraryImagePath(first.name))
assert.ok(recipes.favoriteImagePath(saved.id), 'source deletion must not affect favorite')
const other = recipes.createRecipe(second.name)
recipes.deleteRecipe(other.id)
assert.ok(library.libraryImagePath(second.name), 'unfavorite must not delete source')
assert.equal(recipes.favoriteImagePath(other.id), null)
const old = recipes.createConfigRecipe(record('old configuration', null).request)
assert.equal(old.imageUrl, undefined)
assert.equal(recipes.favoriteImagePath('../../secrets'), null)
// Simulate an old favorite that predates independent-image storage.
const legacy = {
  ...other,
  id: require('node:crypto').randomUUID(),
  imageUrl: undefined,
  contentHash: undefined,
}
fs.writeFileSync(join(profile, 'data/recipes', legacy.id + '.json'), JSON.stringify(legacy))
assert.ok(recipes.listRecipes().find((item) => item.id === legacy.id).imageUrl)
assert.ok(recipes.favoriteImagePath(legacy.id), 'legacy favorites gain an independent image')
const workspaceImage = library.storeGeneratedImage(
  bytes,
  record('workspace image', 789),
  'workspace',
  require('node:crypto').randomUUID(),
)
const workspaceFavorite = recipes.createRecipe(workspaceImage.name)
fs.unlinkSync(library.libraryImagePath(workspaceImage.name))
assert.ok(
  recipes.favoriteImagePath(workspaceFavorite.id),
  'workspace cleanup must not affect favorite',
)
recipes.deleteRecipe(workspaceFavorite.id)
const variantImage = library.storeGeneratedImage(bytes, record('dog, outdoors', 789), 'saved')
const variant = recipes.createRecipe(variantImage.name)
const { groupFavorites } = require('../../src/shared/images/favorite-groups.ts')
assert.equal(groupFavorites(recipes.listRecipes()).length, 3, 'seed variants share one group')
const changed = structuredClone(variant)
changed.id = 'different-negative'
changed.recipe.request.negative = 'different negative'
assert.equal(
  groupFavorites([variant, changed]).length,
  2,
  'different negative prompts must not merge',
)
changed.recipe = { ...structuredClone(variant.recipe), sourceKind: 'inpaint' }
assert.equal(
  groupFavorites([changed, { ...changed, id: 'other-inpaint' }]).length,
  2,
  'inpaint cannot merge without source/mask equivalence',
)
const reordered = structuredClone(variant)
reordered.recipe.request.params = Object.fromEntries(
  Object.entries(reordered.recipe.request.params).reverse(),
)
assert.equal(
  groupFavorites([variant, reordered]).length,
  1,
  'property order does not affect grouping',
)
const { restoreWindowBounds } = require('../../src/main/app/window.ts')
assert.deepEqual(
  restoreWindowBounds(
    { x: 100, y: 80, width: 1200, height: 800 },
    { x: 0, y: 0, width: 1920, height: 1080 },
  ),
  { x: 100, y: 80, width: 1200, height: 800 },
)
assert.deepEqual(
  restoreWindowBounds(
    { x: 4000, y: -800, width: 1440, height: 900 },
    { x: 0, y: 0, width: 1280, height: 800 },
  ),
  { x: 0, y: 0, width: 1280, height: 800 },
)
const exported = join(profile, 'exported-favorite.png')
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
const handlers = {
  'settings:get': () => getSettings(),
  'settings:save': (_, patch) => saveSettings(patch),
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'db:status': () => ({
    loaded: true,
    tagCount: 3,
    aliasCount: 0,
    zhCount: 0,
    implicationCount: 0,
  }),
  'pages:list': () => [],
  'pages:removed': () => [],
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
}
for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, fn)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    webPreferences: {
      preload: join(__dirname, '../../out/preload/index.js'),
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  })
  const rendererErrors = []
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      rendererErrors.push(details.message)
    }
  })
  require('../../src/main/app/image-protocol.ts').registerImageProtocol()
  require('../../src/main/adapters/ipc/images.ts').registerImagesIpc({
    getWindow: () => win,
    send() {},
    notifyAppChanged() {},
  })
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true)
    } catch (error) {
      throw new Error(code + ': ' + error.message)
    }
  }
  const wait = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) {
        return
      }
      await delay(25)
    }
    throw new Error('Timed out: ' + code)
  }
  const tab = (name) =>
    js(
      `[...document.querySelectorAll('.nav-item')].find(el=>el.textContent.trim()===${JSON.stringify(name)}).click()`,
    )
  try {
    if (process.env.NOVELPROMPT_TEST_RENDERER_URL) {
      await win.loadURL(process.env.NOVELPROMPT_TEST_RENDERER_URL)
    } else {
      await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
    }
    await wait(`document.querySelector('.nav-item')`)
    await delay(400)
    fs.writeFileSync(oldPath, providerPng)
    fs.writeFileSync(oldPath + '.json', JSON.stringify(record('v0.8 image', 321)))
    assert.equal(await js(`window.api.naiSaveAs(${JSON.stringify(oldName)})`), true)
    assert.deepEqual(
      fs.readFileSync(exported),
      providerPng,
      'direct export preserves recovery hash',
    )
    const importedBytes = await js(
      `window.api.naiReadImage(${JSON.stringify(oldName)}).then(bytes => Array.from(bytes))`,
    )
    assert.deepEqual(readPngRecipe(Buffer.from(importedBytes)), record('v0.8 image', 321))
    fs.unlinkSync(oldPath)
    fs.unlinkSync(oldPath + '.json')
    const before = await js(`localStorage.getItem('np-workspace-v1')`)
    await tab('收藏')
    const clickText = (selector, text) =>
      js(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`,
      )
    const open = (name) =>
      js(
        `[...document.querySelectorAll('.favorite-card')].find(el=>el.title===${JSON.stringify(name)}).click()`,
      )
    await wait(`document.querySelectorAll('.favorite-card').length===3`)
    assert.equal(
      await js(`document.querySelector('.favorite-count').textContent.trim()`),
      '2 个版本',
    )
    await open('dog, outdoors')
    await wait(`document.querySelector('.favorite-preview > img')?.naturalWidth>0`)
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('.favorite-preview .favorite-button')).position`,
      ),
      'absolute',
      'preview star stays in its corner',
    )
    assert.equal(
      await js(`document.querySelector('select[aria-label="按种子选择图片"]').options.length`),
      2,
    )
    await js(`document.querySelector('button[aria-label="下一张同配置图片"]').click()`)
    await wait(
      `document.querySelector('select[aria-label="按种子选择图片"]').value===${JSON.stringify(legacy.id)}`,
    )
    assert.match(await js(`document.querySelector('.favorite-details').textContent`), /456/)
    assert.equal(
      await js(`localStorage.getItem('np-workspace-v1')`),
      before,
      'browsing and switching seed variants do not change prompt',
    )
    await delay(150)
    fs.writeFileSync(
      join(profile, 'favorites-detail.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    const beforeBounds = win.getBounds()
    await js(`document.querySelector('button[aria-label="导出收藏原图"]').click()`)
    await delay(200)
    assert.deepEqual(readPngRecipe(fs.readFileSync(exported)), record('dog, outdoors', 456))
    await clickText('.favorite-details footer button', '载入配置')
    await wait(`JSON.parse(localStorage.getItem('np-workspace-v1'))?.prompt==='dog, outdoors'`)
    assert.equal(
      await js(`document.querySelector('.topbar-title').textContent.trim()`),
      '收藏',
      'loading stays on the same page',
    )
    assert.deepEqual(win.getBounds(), beforeBounds, 'loading preserves window bounds')
    assert.equal(
      await js(`JSON.parse(localStorage.getItem('np-workspace-v1')).prompt`),
      'dog, outdoors',
    )
    assert.equal(await js(`JSON.parse(localStorage.getItem('np-workspace-v1')).params.width`), 64)
    await tab('生图预览')
    assert.equal(await js(`document.querySelector('input[aria-label="种子"]').value`), '456')
    await tab('收藏')
    await js(`document.querySelector('.favorite-details footer input').click()`)
    await clickText('.favorite-details footer button', '载入配置')
    await delay(150)
    assert.equal(
      await js(`document.querySelector('input[aria-label="种子"]').value`),
      '',
      'unchecked seed loads as random',
    )
    // Cancel confirmation does not mutate the record; confirmed removal affects just this image.
    await js(`document.querySelector('.favorite-preview .favorite-button').click()`)
    await wait(`document.querySelector('.favorite-confirm:popover-open')`)
    assert.equal(recipes.listRecipes().length, 4)
    await clickText('.favorite-confirm:popover-open button', '保留')
    assert.equal(recipes.listRecipes().length, 4)
    await js(`document.querySelector('.favorite-preview .favorite-button').click()`)
    await clickText('.favorite-confirm:popover-open button', '取消收藏')
    await wait(`!document.querySelector('select[aria-label="按种子选择图片"]')`)
    assert.equal(recipes.listRecipes().length, 3)
    assert.ok(recipes.favoriteImagePath(variant.id), 'other seed remains collected')
    assert.ok(library.libraryImagePath(second.name), 'source is preserved')
    assert.match(await js(`document.body.innerText`), /已取消这张图片的收藏/)
    assert.match(await js(`document.querySelector('.favorite-details').textContent`), /789/)
    await tab('生图预览')
    await wait(`document.querySelector('.gallery .thumb')`)
    await js(
      `[...document.querySelectorAll('.gallery .thumb')].find(el=>el.querySelector('img')?.src.includes(${JSON.stringify(second.name)})).click()`,
    )
    await wait(`document.querySelector('.viewer .favorite-button')`)
    assert.equal(
      await js(`document.querySelector('.viewer .favorite-button').getAttribute('aria-pressed')`),
      'false',
    )
    await js(`document.querySelector('.viewer .favorite-button').click()`)
    await wait(
      `document.querySelector('.viewer .favorite-button').getAttribute('aria-pressed')==='true'`,
    )
    assert.match(await js(`document.body.innerText`), /已收藏图片与生成记录/)
    assert.equal(
      await js(`document.querySelector('.viewer .favorite-button').getBoundingClientRect().width`),
      26,
    )
    const target = await js(
      `(()=>{const r=document.querySelector('.viewer .favorite-button').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    )
    await delay(200)
    const activeColor = await js(
      `getComputedStyle(document.querySelector('.viewer .favorite-button')).color`,
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', ...target })
    await delay(200)
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.viewer .favorite-button')).color`),
      activeColor,
      'hover preserves active star color',
    )
    // The gallery shows all groups directly and restores its scroll position after inspection.
    for (let i = 0; i < 120; i++) {
      recipes.createConfigRecipe(record('configuration ' + i, null).request)
    }
    await tab('收藏')
    await clickText('.favorites-navigation button', '全部收藏')
    await wait(`document.querySelectorAll('.favorite-card').length===123`)
    assert.equal(await js(`document.querySelector('.favorite-pagination')`), null)
    await delay(100)
    await js(`document.querySelector('.favorites-grid').scrollTop = 100000`)
    await delay(100)
    assert.equal(await js(`document.querySelectorAll('.favorite-card').length`), 123)
    const browseScroll = await js(`document.querySelector('.favorites-grid').scrollTop`)
    await js(`document.querySelectorAll('.favorite-card')[30].click()`)
    await clickText('.favorites-navigation button', '全部收藏')
    await delay(150)
    assert.equal(await js(`document.querySelector('.favorites-grid').scrollTop`), browseScroll)
    await wait(`document.querySelectorAll('.favorite-card').length===123`)
    await js(
      `(()=>{const input=document.querySelector('input[aria-label="搜索收藏"]');input.value='dog, outdoors';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await wait(`document.querySelectorAll('.favorite-card').length===1`)
    assert.equal(
      await js(`document.querySelector('.favorite-count').textContent.trim()`),
      '2 个版本',
    )
    await js(
      `(()=>{const input=document.querySelector('input[aria-label="搜索收藏"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await wait(`document.querySelectorAll('.favorite-card').length===123`)
    fs.writeFileSync(
      join(profile, 'favorites-grid.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await js(
      `(()=>{const input=document.querySelector('input[aria-label="搜索收藏"]');input.value='dog, outdoors';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await wait(`document.querySelectorAll('.favorite-card').length===1`)
    await open('dog, outdoors')
    win.setSize(1100, 700)
    await delay(200)
    const layout = await js(
      `(()=>{const f=document.querySelector('.favorite-details footer');const l=f.querySelector('label').getBoundingClientRect(),b=f.querySelector('.primary').getBoundingClientRect();return {sameRow:Math.abs(l.y+l.height/2-b.y-b.height/2)<2,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
    )
    assert.ok(layout.sameRow, 'seed option and load button stay on one row')
    assert.equal(layout.overflow, false)
    fs.writeFileSync(
      join(profile, 'favorites-compact.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    assert.deepEqual(rendererErrors, [], 'renderer must start and run without hidden errors')
    console.log(
      'PASS durable storage, seed grouping, distinct configurations, ordinary gallery/search and scroll restoration, browse isolation, in-place loading, seed choice, confirmation, toasts, compact stars, hover stability, window bounds and compact layout. Artifacts:',
      profile,
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    console.error(rendererErrors)
    console.error(await js('document.body.innerText'))
    app.exit(1)
  }
})
