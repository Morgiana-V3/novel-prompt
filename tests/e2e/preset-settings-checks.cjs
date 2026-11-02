const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { ipcMain } = require('electron')
module.exports = async function checkPresetSettings({
  js,
  waitUI,
  win,
  profile,
  getOptimize,
  getPreview,
}) {
  const { freeCheck } = require('../../src/main/modules/generation/costs.ts')
  ipcMain.removeHandler('nai:freeCheck')
  ipcMain.handle('nai:freeCheck', (_, params, version, sub) => freeCheck(params, version, sub))
  const select = async (selector, label) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await waitUI(`!!document.querySelector('.theme-select-menu [role="option"]')`)
    await js(
      `(() => { const option = [...document.querySelectorAll('.theme-select-menu [role="option"]')].find(el => el.querySelector('span').textContent.trim() === ${JSON.stringify(label)}); option.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true })); option.click(); })()`,
    )
  }
  const set = (selector, value, event = 'input') =>
    js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('${event}', { bubbles:true })); })()`,
    )
  const base = '#creation-editor textarea[aria-label="主提示词"]'
  await set(base, 'comic, screentone, 1girl')
  await set('.ai .composer textarea', '保留网点和漫画分格')
  const quality = '#creation-editor [aria-label="内置质量词"]'
  await select(quality, '质量词 · None')
  await select('#creation-editor [aria-label="内置负面预设"]', 'UC · 无')
  const requestBefore = getOptimize()
  await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
  await waitUI(`!document.querySelector('.ai .run-bar .btn.accent').disabled`)
  assert.notEqual(getOptimize(), requestBefore)
  assert.deepEqual(getOptimize().promptPresets, {
    qualityTags: false,
    qualityMode: 'standard',
    ucPreset: 'none',
  })
  assert.equal(getOptimize().prompt, 'comic, screentone, 1girl')
  await js(
    `[...document.querySelectorAll('.side-bottom .seg button')].find(el => el.textContent.trim() === 'V5').click()`,
  )
  await waitUI(`document.querySelector('.side-bottom .seg button.on').textContent.trim() === 'V5'`)
  await select(quality, '质量词 · Light')
  await select('#creation-editor [aria-label="内置负面预设"]', 'UC · Human Focus')
  await waitUI(`!!document.querySelector('.preset-change-note')`)
  await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
  await waitUI(
    `!document.querySelector('.ai .run-bar .btn.accent').disabled && !document.querySelector('.preset-change-note')`,
  )
  assert.deepEqual(getOptimize().promptPresets, {
    qualityTags: true,
    qualityMode: 'light',
    ucPreset: 'human',
  })
  await js(
    `document.querySelector('#creation-tab-preview').click(); document.querySelector('.preview .run-bar .btn.accent').click()`,
  )
  await waitUI(`!document.querySelector('.preview .run-bar .btn.accent').disabled`)
  assert.equal(getPreview().params.qualityTags, true)
  assert.equal(getPreview().params.qualityMode, 'light')
  assert.equal(getPreview().params.ucPreset, 'human')
  await js(
    `document.querySelector('#creation-tab-compare').click(); document.querySelector('.creation-parameters-toggle').click()`,
  )
  const popup = '#creation-generation-settings'
  assert.equal(
    await js(`document.querySelector('${popup}').textContent.includes('UC 预设')`),
    false,
  )
  assert.equal(
    await js(`document.querySelector('${popup}').textContent.includes('Add Quality Tags')`),
    false,
  )
  const size = `${popup} [aria-label="尺寸档位"]`
  const orient = (label) =>
    js(
      `[...document.querySelectorAll('${popup} .resolution-picker button')].find(el => el.textContent.trim() === '${label}').click()`,
    )
  await select(size, '大图 · Large')
  await orient('竖图')
  await waitUI(
    `document.querySelector('${popup} .param .side-label').textContent.includes('1024×1536')`,
  )
  await waitUI(`document.querySelector('.fee-status').textContent === '需调整'`)
  await select(size, '壁纸 · Wallpaper')
  await orient('横图')
  await waitUI(
    `document.querySelector('${popup} .param .side-label').textContent.includes('1920×1088')`,
  )
  assert.equal(
    await js(
      `[...document.querySelectorAll('${popup} .resolution-picker button')].find(el => el.textContent.trim() === '方图').disabled`,
    ),
    true,
  )
  await select(size, '小图 · Small')
  await orient('方图')
  await waitUI(
    `document.querySelector('${popup} .param .side-label').textContent.includes('640×640')`,
  )
  await select(size, '自定义 · Custom')
  await set(`${popup} [aria-label="自定义宽度"]`, '896', 'change')
  await set(`${popup} [aria-label="自定义高度"]`, '1152', 'change')
  await waitUI(
    `document.querySelector('${popup} .param .side-label').textContent.includes('896×1152')`,
  )
  await select(size, '标准 · Normal')
  await orient('横图')
  await waitUI(
    `document.querySelector('${popup} .param .side-label').textContent.includes('1216×832')`,
  )
  await waitUI(`document.querySelector('.fee-status').textContent === '预计免费'`)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  // Keep a compact, readable fixture for reviewing the actual rendered controls.
  await js(`document.querySelector('#creation-editor').scrollTop = 0`)
  await waitUI(`!document.querySelector('.toast')`)
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.ok(
      await js(
        `(() => { const dock = document.querySelector('#creation-generation-controls'); const q = document.querySelector('${quality}').getBoundingClientRect(); const text = document.querySelector('${base}').getBoundingClientRect(); return dock.scrollWidth <= dock.clientWidth + 1 && q.left >= text.left && q.right <= text.right && q.bottom <= text.bottom; })()`,
      ),
    )
    writeFileSync(
      join(profile, `generation-redesign-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  console.log(
    'PASS inline preset controls feed optimization/forecast, changed settings mark stale advice, all size tiers/custom update the dock and free eligibility',
  )
}
