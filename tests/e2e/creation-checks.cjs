const assert = require('node:assert/strict')
const { ipcMain } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

/** Run in the prompt regression's isolated, offline renderer. */
module.exports = async function checkCreation({
  win,
  js,
  click,
  waitUI,
  profile,
  image,
  getPreviewRequest,
  getCopied,
}) {
  const base = '#creation-editor textarea[aria-label="主提示词"]'
  const edit = async (selector, text) => {
    await js(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      input.focus()
      input.dispatchEvent(new FocusEvent('focus'))
      input.value = ${JSON.stringify(text)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
  }
  const panel = async (key) => {
    await js(`document.querySelector('#creation-tab-${key}').click()`)
    await waitUI(
      `document.querySelector('#creation-tab-${key}').getAttribute('aria-selected') === 'true'`,
    )
  }
  const value = () => js(`document.querySelector(${JSON.stringify(base)}).value`)
  let calls = 0
  let release
  let request
  let generated = false
  ipcMain.removeHandler('nai:freeCheck')
  ipcMain.handle('nai:freeCheck', () => ({ ok: true, reasons: [], notes: [] }))
  ipcMain.removeHandler('nai:list')
  ipcMain.handle('nai:list', () =>
    generated ? [image, { ...image, name: 'creation-result.png' }] : [image],
  )
  ipcMain.handle('nai:generate', (_, payload) => {
    calls++
    request = payload
    return new Promise((resolve) => {
      release = () => {
        generated = true
        resolve({ images: [{ ...image, name: 'creation-result.png' }] })
      }
    })
  })
  ipcMain.handle('nai:recipe', () => ({ request }))

  await click('.nav-item', '创作实验')
  await waitUI(`document.querySelector('.creation-active .compare .stats')`)
  assert.equal(await js(`document.querySelectorAll('.compare').length`), 1)
  assert.equal(await js(`document.querySelectorAll('.ai').length`), 1)
  assert.equal(await js(`document.querySelectorAll('.generate').length`), 1)
  assert.equal(await js(`document.querySelectorAll('.compare textarea').length`), 0)
  assert.ok(
    await js(
      `document.querySelector('#creation-generation-controls .run-bar .btn.accent').offsetHeight > 0`,
    ),
  )
  // Slash search uses native input events and keeps surrounding prose/punctuation intact.
  const input = (text) => js(`document.execCommand('insertText', false, ${JSON.stringify(text)})`)
  const key = (key, composing = false) =>
    js(
      `document.querySelector(${JSON.stringify(base)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, isComposing: ${composing}, bubbles: true, cancelable: true }))`,
    )
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250))
  const noPopup = async () => {
    await settle()
    assert.equal(await js(`!!document.querySelector('.tag-complete')`), false)
  }
  const search = async (query, expected, prefix = 'masterpiece, ', suffix = '') => {
    await edit(base, prefix + suffix)
    await js(
      `document.querySelector(${JSON.stringify(base)}).setSelectionRange(${prefix.length}, ${prefix.length})`,
    )
    await input('/')
    await waitUI(`!!document.querySelector('.tag-complete')`)
    if (query) {
      await input(query)
    }
    if (expected) {
      await waitUI(
        `document.querySelector('.tag-complete .tag-complete-item.active b')?.textContent === ${JSON.stringify(expected)}`,
      )
    }
  }
  await edit(base, 'many')
  await waitUI(`document.querySelectorAll('.tag-complete-item').length === 20`)
  await search('many', 'many 1')
  assert.equal(await js(`document.querySelectorAll('.tag-complete-item').length`), 20)
  await js(
    `document.querySelector('.tag-complete').getAnimations().forEach(animation => animation.finish())`,
  )
  assert.equal(
    await js(`document.querySelectorAll('.tag-complete-hint').length`),
    0,
    'candidate results contain no persistent instructions or count',
  )
  for (let i = 0; i < 19; i++) {
    await key('ArrowDown')
  }
  assert.equal(
    await js(`document.querySelector('.tag-complete-item.active b').textContent`),
    'many 20',
  )
  assert.ok(
    await js(`(() => {
    const list = document.querySelector('.tag-complete-list')
    const item = list.querySelector('.active').getBoundingClientRect()
    const box = list.getBoundingClientRect()
    return list.scrollTop > 0 && item.top >= box.top && item.bottom <= box.bottom + 1
  })()`),
    'keyboard navigation reaches and reveals candidates beyond eight',
  )
  writeFileSync(join(profile, 'tag-search-20.png'), (await win.webContents.capturePage()).toPNG())
  await key('Enter')
  assert.equal(await value(), 'masterpiece, many 20')
  const setCandidateLimit = async (limit) => {
    await key('Escape')
    await click('.nav-item', '设置')
    await click('.settings-tabs button', 'Tag 词库')
    await edit('#settings-tag-completion-limit', String(limit))
    await click('.tags-save', '保存词库设置')
    await waitUI(`!document.querySelector('.tags-save')`)
    await click('.nav-item', '创作实验')
  }
  await setCandidateLimit(8)
  await edit(base, 'many')
  await waitUI(`document.querySelectorAll('.tag-complete-item').length === 8`)
  assert.ok(
    await js(`(() => {
    const list = document.querySelector('.tag-complete-list')
    return list.scrollHeight === list.clientHeight
  })()`),
    'eight configured candidates fit without scrolling',
  )
  await search('many', 'many 1')
  assert.equal(await js(`document.querySelectorAll('.tag-complete-item').length`), 8)
  await setCandidateLimit(20)
  console.log('PASS saved candidate count immediately applies to automatic and slash search')

  console.log(
    'PASS automatic and slash search default to twenty; keyboard selection and no persistent hints',
  )
  await edit(base, 'masterpiece, twi')
  await waitUI(`document.querySelector('.tag-complete-item.active b')?.textContent === 'twintails'`)
  await key('Enter')
  assert.equal(await value(), 'masterpiece, twintails', 'automatic completion adds no separator')
  await noPopup()
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'masterpiece, twi')
  await noPopup()
  await edit(base, 'artist:wl')
  await waitUI(
    `document.querySelector('.tag-complete-item.active b')?.textContent === 'artist:wlop'`,
  )
  await key('Tab')
  assert.equal(await value(), 'artist:wlop')
  await edit(base, 'Text: twi')
  await noPopup()
  console.log(
    'PASS automatic completion coexists with slash search, artist filter, undo and no trailing separator',
  )
  await search('twi', 'twintails')
  await settle()
  writeFileSync(join(profile, 'tag-complete.png'), (await win.webContents.capturePage()).toPNG())
  await key('Enter')
  assert.equal(await value(), 'masterpiece, twintails')
  await noPopup()
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'masterpiece, /twi', 'completion is a single undo step')
  await noPopup()

  await search('te', 'Text:')
  await key('Tab')
  assert.equal(await value(), 'masterpiece, Text: ')
  await search('artist:wl', 'artist:wlop')
  await key('Enter')
  assert.equal(await value(), 'masterpiece, artist:wlop')

  await search('long hair', 'long hair', 'A girl with ', ' stands here.')
  await key('Enter', true)
  assert.equal(
    await value(),
    'A girl with /long hair stands here.',
    'IME Enter cannot accept a tag',
  )
  await js(
    `document.querySelector('.tag-complete-item.active').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`,
  )
  assert.equal(await value(), 'A girl with long hair stands here.')
  await search('长发', 'long hair')
  await key('Tab')
  assert.equal(await value(), 'masterpiece, long hair')

  await search('twi', 'twintails')
  await key('Escape')
  await input('n')
  await noPopup()
  assert.equal(await value(), 'masterpiece, /twin', 'Escape preserves query and ends the session')

  await search('twi', 'twintails')
  await js(
    `(() => { const el = document.querySelector(${JSON.stringify(base)}); el.setSelectionRange(13,14); document.execCommand('delete') })()`,
  )
  await noPopup()
  assert.equal(await value(), 'masterpiece, twi', 'deleting slash ends search without losing query')

  await search('twi', 'twintails')
  await js(`document.querySelector(${JSON.stringify(base)}).setSelectionRange(0,0)`)
  await noPopup()
  await input('hello ')
  await noPopup()

  await search('twi', 'twintails')
  await input('zzz')
  await key('Enter')
  assert.ok(
    !(await value()).includes('twintails'),
    'stale candidates cannot replace new input during debounce',
  )
  await waitUI(`document.querySelector('.tag-complete')?.textContent.includes('没有匹配')`)
  await key('Escape')
  await edit(base, '')
  await input('https://example.com/twi')
  await noPopup()
  await input('/')
  await noPopup()
  await edit(base, '/twi')
  await noPopup()
  console.log(
    'PASS slash search, spaces, Chinese, exact match, native undo, IME, exit and stale candidate protection',
  )
  await edit(base, 'masterpiece, twin tails, bogus')
  await waitUI(
    `document.querySelector('.compare .alias-item') && document.querySelector('.compare .unknown-item')`,
  )
  await js(`document.querySelector('.compare .alias-item button').click()`)
  assert.equal(await value(), 'masterpiece, twintails, bogus')
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'masterpiece, twin tails, bogus', 'replacement preserves native undo')
  const character = '#creation-editor .char-block textarea[data-src="pos"]'
  await edit(character, 'twin tails')
  await waitUI(
    `document.querySelector('.compare .section-tab.on').textContent.includes('角色 1') && !!document.querySelector('.compare .alias-item')`,
  )
  await js(`document.querySelector('.compare .alias-item button').click()`)
  assert.equal(await js(`document.querySelector(${JSON.stringify(character)}).value`), 'twintails')
  assert.equal(
    await value(),
    'masterpiece, twin tails, bogus',
    'character replacement cannot change base',
  )
  await edit(base, 'masterpiece, best quality, upper body, window, sunlight, twin tails, bogus')
  await waitUI(
    `document.querySelector('.compare .section-tab.on').textContent.includes('主提示词') && !!document.querySelector('.compare .unknown-item')`,
  )
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.ok(
      await js(`(() => {
      const footer = document.querySelector('#creation-generation-controls').getBoundingClientRect()
      const generate = document.querySelector('#creation-generation-controls .run-bar .btn.accent').getBoundingClientRect()
      const editor = document.querySelector('#creation-editor').getBoundingClientRect()
      const results = document.querySelector('.creation-results').getBoundingClientRect()
      return footer.bottom <= innerHeight + 1 && footer.height >= 40 && footer.height <= 52 && editor.width > 200
        && results.width > 250 && results.right <= innerWidth + 1
        && editor.right <= results.left + 1 && Math.abs(editor.width - footer.width) < 1
        && document.documentElement.scrollWidth <= innerWidth
        && generate.width > 60 && generate.right <= innerWidth && generate.bottom <= innerHeight
    })()`),
      'editor, results and generation controls fit the viewport',
    )
    assert.ok(
      await js(`['.creation-tabs', '.compare .section-tabs'].every(selector => {
        const row = document.querySelector(selector)
        const tops = [...row.children].map(child => Math.round(child.getBoundingClientRect().top))
        return row.classList.contains('scroll-row') && new Set(tops).size === 1
      })`),
      'tab rows stay on one line and scroll sideways instead of wrapping',
    )
    writeFileSync(
      join(profile, `creation-check-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
    await require('./generation-popover-checks.cjs')({ js, waitUI, win, profile, width })
  }

  await panel('ai')
  assert.equal(await js(`document.querySelectorAll('.ai textarea[data-src]').length`), 0)
  await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
  await waitUI(`document.querySelector('.ai .cheer .actions .primary')`)
  await edit(base, 'sunlight, garden')
  await js(`document.querySelector('.ai .cheer .actions .primary').click()`)
  assert.equal(await value(), 'sunlight, garden', 'stale AI result cannot overwrite edits')
  await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
  await waitUI(`document.querySelector('.ai .cheer .actions .primary')`)
  await js(`document.querySelector('.ai .cheer .actions .primary').click()`)
  await waitUI(`document.querySelector(${JSON.stringify(base)}).value === 'outdoors'`)
  await click('.ai .cheer button', '撤销采用')
  assert.equal(await value(), 'sunlight, garden')

  await panel('preview')
  assert.equal(await js(`document.querySelectorAll('.preview textarea').length`), 0)
  await js(`document.querySelector('.preview .run-bar .btn.accent').click()`)
  await waitUI(`!!document.querySelector('.preview .forecast-meta')`)
  assert.equal(getPreviewRequest().forecastOnly, true)
  assert.equal(
    getPreviewRequest().expectation,
    '',
    'old-page expectations do not leak into forecasting',
  )
  assert.ok(
    await js(
      `!document.querySelector('.preview').textContent.includes('带着建议去 AI 优化') && !document.querySelector('.preview').textContent.includes('整体偏暗')`,
    ),
  )
  await click('.preview button', '复制推测结果')
  assert.ok(
    getCopied().includes('【画面】') &&
      !getCopied().includes('【建议】') &&
      !getCopied().includes('【与期望的差距】'),
  )
  await js(`document.getAnimations().forEach(animation => { try { animation.finish() } catch {} })`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.ok(
    await js(`(() => {
    const point = document.querySelector('.preview .point-grid .result-card')
    return point && getComputedStyle(point).opacity === '1' && point.getBoundingClientRect().height > 0
  })()`),
    'forecast details are visible after layout settles',
  )
  writeFileSync(
    join(profile, 'creation-forecast.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  assert.equal(
    await js(`document.querySelector('.nav-item.active').textContent.trim()`),
    '创作实验',
  )

  await panel('compare')
  // A change triggers the existing debounced free eligibility check.
  await js(
    `document.querySelector('#creation-generation-controls .creation-parameters-toggle').click()`,
  )
  await js(`document.querySelector('.side-bottom .seg button').click()`)
  await waitUI(
    `document.querySelector('#creation-generation-controls .fee-status')?.textContent.includes('预计免费')`,
  )
  await js(
    `document.querySelector('#creation-generation-controls .creation-parameters-toggle').click()`,
  )
  await js(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`,
  )
  await waitUI(
    `document.querySelector('#creation-tab-generate').getAttribute('aria-selected') === 'true'`,
  )
  assert.equal(calls, 1, 'shortcut sends one generation request')
  assert.equal(request.base, 'sunlight, garden')
  await edit(base, 'sunlight, garden, window')
  await click('.nav-item', '生图预览')
  assert.ok(await js(`document.querySelector('.generate .run-bar .btn.accent').disabled`))
  release()
  await waitUI(
    `!!document.querySelector('.generate .viewer') && !document.querySelector('.generate .run-bar .btn.accent').disabled`,
  )
  assert.equal(calls, 1)
  await click('.nav-item', '创作实验')
  await waitUI(
    `document.querySelector('.generate .evidence-note.warn')?.textContent.includes('上一次配置')`,
  )
  assert.equal(
    await js(`document.querySelector('.generate').textContent.includes('推测 vs 实际')`),
    false,
  )
  assert.equal(await value(), 'sunlight, garden, window')
  await js(`document.querySelector('.generate .thumb').click()`)
  assert.equal(await value(), 'sunlight, garden, window', 'browsing does not replace draft')
  await js(
    `document.querySelector('.generate .viewer button[title="加载这张图的提示词和生成参数"]').click()`,
  )
  await waitUI(`document.querySelector(${JSON.stringify(base)}).value === 'sunlight, garden'`)
  await panel('compare')
  await click('.nav-item', '提示词比对')
  await waitUI(`document.querySelector('.compare textarea')?.value === 'sunlight, garden'`)
  assert.ok(await js(`document.querySelector('.compare .left').offsetWidth > 0`))
  await click('.nav-item', 'AI 优化')
  assert.ok(await js(`document.querySelector('.ai .prompt-group textarea').offsetWidth > 0`))
  await click('.nav-item', '画面推测')
  assert.ok(await js(`document.querySelector('.preview textarea[data-src]').offsetWidth > 0`))
  assert.ok(
    await js(
      `document.querySelector('.preview').textContent.includes('想要的效果（可选）') && document.querySelector('.preview').textContent.includes('带着建议去 AI 优化')`,
    ),
  )
  await click('.nav-item', '生图预览')
  assert.ok(await js(`document.querySelector('.generate textarea[data-src]').offsetWidth > 0`))
  assert.equal(
    await js(`document.querySelectorAll('#creation-generation-controls .pane').length`),
    0,
  )
  console.log(
    'PASS creation shares controllers and undo, keeps forecasting separate from edits, preserves old review, generation lock, image restoration and layout',
  )
}
