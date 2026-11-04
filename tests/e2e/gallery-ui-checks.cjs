const assert = require('node:assert/strict')
const { ipcMain } = require('electron')
const { join } = require('node:path')
const { writeFileSync, existsSync } = require('node:fs')
const { PNG } = require('pngjs')
module.exports = async function checkGallery({ js, click, ui, win, profile }) {
  const { imageCollections } = require('../../src/main/modules/images/collections.ts')
  const library = require('../../src/main/modules/images/library.ts')
  const set = imageCollections.create('场景练习')
  const recipe = {
    schema: 1,
    createdAt: Date.now(),
    sourceKind: 'generate',
    request: {
      base: 'landscape',
      negative: '',
      characters: [],
      version: 'v5',
      params: {
        width: 128,
        height: 128,
        steps: 23,
        scale: 5,
        cfgRescale: 0,
        sampler: 'k_euler',
        noiseSchedule: 'native',
        seed: 1,
        count: 1,
        qualityTags: false,
        ucPreset: 'none',
      },
    },
  }
  const fixtures = []
  for (let k = 0; k < 8; k++) {
    const png = new PNG({ width: 128, height: 128 })
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4
        png.data[i] = 100 + k * 15
        png.data[i + 1] = 100 + y
        png.data[i + 2] = 150 + Math.floor(x / 2)
        png.data[i + 3] = 255
      }
    }
    fixtures.push(
      library.storeGeneratedImage(
        PNG.sync.write(png),
        recipe,
        k === 0 ? 'temporary' : 'saved',
        undefined,
        k < 4 ? set.id : 'default',
      ),
    )
  }
  const handlers = {
    'collections:list': () => imageCollections.list(),
    'collections:create': (_, name) => imageCollections.create(name),
    'collections:rename': (_, id, name) => imageCollections.rename(id, name),
    'collections:delete': (_, id) => imageCollections.remove(id),
    'collections:assign': (_, names, id) => imageCollections.assign(names, id),
    'nai:list': () =>
      fixtures.map((f) => ({
        ...library.imageInfo(f.name),
        url: `data:image/png;base64,${library.imageBytesWithRecipe(f.name).toString('base64')}`,
      })),
    'nai:retain': (_, name) => library.retainImage(name),
    'nai:recipe': (_, name) => library.readImageRecipe(name),
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
  win.webContents.send('gallery:changed', null)
  await click('.nav-item', '图集管理')
  assert.ok(
    await js(
      `(() => { const tabs = [...document.querySelectorAll('.nav-item')].map(el => el.textContent.trim()); return tabs.indexOf('图集管理') === tabs.indexOf('收藏管理') - 1 && tabs.indexOf('图集管理') > tabs.indexOf('图片精修') })()`,
    ),
  )
  await ui(`document.querySelectorAll('.library-thumb').length === 8`)
  await click('.collection-item span', '场景练习')
  await ui(`document.querySelectorAll('.library-thumb').length === 4`)
  await click('.nav-item', '生图创作')
  await click('.creation-tab', '图片预览')
  await ui(
    `document.querySelector('[aria-label="图片图集"]').textContent.includes('场景练习') && document.querySelectorAll('.gallery .thumb').length === 4`,
  )
  await js(`document.querySelector('[aria-label="图库筛选"]').click()`)
  await click('[role="option"]', '临时未留存')
  await ui(`document.querySelectorAll('.gallery .thumb').length === 1`)
  await js(`document.querySelector('[aria-label="图库筛选"]').click()`)
  await click('[role="option"]', '已留存')
  await ui(`document.querySelectorAll('.gallery .thumb').length === 3`)
  await js(`document.querySelector('[aria-label="图库筛选"]').click()`)
  await click('[role="option"]', '全部状态')
  await ui(`document.querySelectorAll('.gallery .thumb').length === 4`)
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 220))
    assert.ok(
      await js(
        `(() => { const head = document.querySelector('.gallery-head'); return head.scrollWidth <= head.clientWidth + 1 })()`,
      ),
      'collection and retention filters fit the generation pane',
    )
    writeFileSync(
      join(profile, `generation-gallery-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  await js(`document.querySelector('[aria-label="图片图集"]').click()`)
  await click('[role="option"]', '默认图集')
  await ui(`document.querySelectorAll('.gallery .thumb').length === 4`)
  await click('.nav-item', '图集管理')
  await ui(
    `document.querySelector('.library-toolbar h2').textContent.includes('默认图集') && document.querySelectorAll('.library-thumb').length === 4`,
  )
  await click('.collection-item span', '场景练习')
  await ui(`document.querySelectorAll('.library-thumb').length === 4`)
  await js(`document.querySelector('.library-thumb').click()`)
  await click('.library-actions button', '留存图片')
  await ui(`!document.querySelector('.library-actions .primary')`)
  assert.equal(library.imageInfo(fixtures[0].name).storage, 'saved')
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 220))
    assert.ok(
      await js(
        `document.querySelector('.library-view').scrollWidth <= document.querySelector('.library-view').clientWidth + 1`,
      ),
    )
    writeFileSync(
      join(profile, `gallery-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  await js(`document.querySelector('[aria-label="新建图集"]').click()`)
  assert.equal(
    await js(`document.querySelector('[aria-label="图集名称"]').classList.contains('input')`),
    true,
  )
  await js(
    `const nameInput = document.querySelector('[aria-label="图集名称"]'); nameInput.value = '角色研究'; nameInput.dispatchEvent(new Event('input', {bubbles: true}));`,
  )
  await click('.collection-form button', '保存')
  await ui(`document.querySelector('.library-toolbar h2').textContent.includes('角色研究')`)
  const created = imageCollections.list().find((c) => c.name === '角色研究')
  assert.ok(created)
  await click('.collection-item span', '全部图片')
  await js(`document.querySelector('.library-thumb').click()`)
  await js(`document.querySelector('[aria-label="图片所属图集"]').click()`)
  await click('[role="option"]', '角色研究')
  await ui(`document.querySelector('[aria-label="图片所属图集"]').textContent.includes('角色研究')`)
  assert.equal(imageCollections.forImage(fixtures[0].name), created.id)
  await click('.collection-item span', '角色研究')
  await ui(`document.querySelectorAll('.library-thumb').length === 1`)
  await click('.library-toolbar button', '重命名')
  await js(
    `const renameInput = document.querySelector('[aria-label="图集名称"]'); renameInput.value = '角色定稿'; renameInput.dispatchEvent(new Event('input', {bubbles: true}));`,
  )
  await click('.collection-form button', '保存')
  await ui(`document.querySelector('.library-toolbar h2').textContent.includes('角色定稿')`)
  // Picker observes changes through the same production gallery event.
  win.webContents.send('gallery:changed', null)
  await click('.nav-item', '生图创作')
  await click('.creation-tab', '图片预览')
  await ui(
    `document.querySelector('[aria-label="图片图集"]').textContent.includes('角色定稿') && document.querySelectorAll('.gallery .thumb').length === 1`,
  )
  await click('.nav-item', '生图创作')
  await js(`document.querySelector('[aria-label="生图保存图集"]').click()`)
  await click('[role="option"]', '角色定稿')
  assert.equal(await js(`localStorage.getItem('np-generation-collection')`), created.id)
  await click('.nav-item', '图集管理')
  await click('.collection-item span', '角色定稿')
  await click('.library-toolbar button', '删除图集')
  await ui(`!!document.querySelector('dialog[open]')`)
  await click('dialog button', '删除')
  await ui(`document.querySelector('.library-toolbar h2').textContent.includes('默认图集')`)
  assert.equal(imageCollections.forImage(fixtures[0].name), 'default')
  assert.ok(existsSync(library.libraryImagePath(fixtures[0].name)))
  win.webContents.send('gallery:changed', null)
  await click('.nav-item', '生图创作')
  await click('.creation-tab', '图片预览')
  await ui(
    `document.querySelector('[aria-label="图片图集"]').textContent.includes('默认图集') && document.querySelectorAll('.gallery .thumb').length === 5`,
  )
  console.log(
    'PASS gallery filters/retention, collection create/rename/move/delete, default fallback, generation picker and desktop/narrow layouts',
  )
}
