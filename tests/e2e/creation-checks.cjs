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
  const { parsePrompt } = require('../../src/shared/prompts/parser.ts')
  const { promptSelectionRanges } = require('../../src/shared/prompts/remove-tokens.ts')
  const selectedText = (text, indices) =>
    promptSelectionRanges(
      text,
      indices.map((i) => parsePrompt(text)[i]),
    ).map((range) => text.slice(range.start, range.end))
  assert.deepEqual(selectedText('0.8::artist:saeki shun::, sky', [0]), ['0.8::artist:saeki shun::'])
  assert.deepEqual(selectedText('{{cat}}, [[dog]], -1::bird::', [0, 1, 2]), [
    '{{cat}}',
    '[[dog]]',
    '-1::bird::',
  ])
  assert.deepEqual(selectedText('1.2::{cat}, dog::', [0]), ['{cat}'])
  assert.deepEqual(selectedText('1.2::{cat}, dog::', [0, 1]), ['1.2::{cat}', 'dog::'])
  assert.deepEqual(selectedText('"{{literal}}", Text: 0.8::hello::', [0, 1]), [
    '"{{literal}}"',
    'Text: 0.8::hello::',
  ])
  assert.deepEqual(selectedText('cat\\{ears\\}, dog', [0]), ['cat\\{ears\\}'])
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

  await click('.nav-item', '生图创作')
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
    await click('.nav-item', '应用设置')
    await click('.settings-tabs button', 'Tag 词库')
    await edit('#settings-tag-completion-limit', String(limit))
    await click('.tags-save', '保存词库设置')
    await waitUI(`!document.querySelector('.tags-save')`)
    await click('.nav-item', '生图创作')
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
  // 词条高亮只在「词条检查」分页显示，不依赖前面测试停留在哪个分页
  await panel('compare')
  await edit(base, '0.8::masterpiece::, {{twintails}}, bogus')
  await waitUI(`document.querySelectorAll('.compare .valid-wrap').length === 2`)
  await js(`document.querySelector('.compare .valid-wrap .tag-card').click()`)
  assert.equal(
    await js(`document.querySelectorAll('.compare .token-selected').length`),
    0,
    'ordinary click locates text without applying multi-selection card styling',
  )
  assert.equal(
    await js(
      `(() => { const input = document.querySelector(${JSON.stringify(base)}); return input.value.slice(input.selectionStart, input.selectionEnd) })()`,
    ),
    '0.8::masterpiece::',
  )
  await js(
    `document.querySelectorAll('.compare .valid-wrap .tag-card')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
  )
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.textarea-token-highlights mark')].map(mark => mark.textContent)`,
    ),
    ['{{twintails}}'],
    'first Ctrl-click starts a fresh selection and excludes the previously located tag',
  )
  await js(
    `document.querySelector('.compare .valid-wrap .tag-card').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
  )
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.textarea-token-highlights mark')].map(mark => mark.textContent)`,
    ),
    ['0.8::masterpiece::', '{{twintails}}'],
  )
  await js(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`,
  )
  assert.equal(await value(), 'bogus')
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), '0.8::masterpiece::, {{twintails}}, bogus')
  await edit(base, 'masterpiece, twin tails, bogus')
  await waitUI(
    `document.querySelector('.compare .alias-item') && document.querySelector('.compare .unknown-item')`,
  )
  const pointerClick = async (selector, ctrl = false) => {
    await js(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' })`,
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const point = await js(`(() => {
      const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
      return { x: Math.round(box.left + 20), y: Math.round(box.top + box.height / 2) }
    })()`)
    const modifiers = ctrl ? ['control'] : []
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      modifiers,
      ...point,
    })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      modifiers,
      ...point,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await pointerClick('.compare .unknown-head')
  await pointerClick('.compare .valid-wrap .tag-card', true)
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 1)
  assert.ok(
    await js(`(() => {
    const item = document.querySelector('.compare .valid-wrap')
    const card = item.querySelector('.tag-card')
    return document.activeElement === item && getComputedStyle(card).backgroundColor !== 'rgb(255, 255, 255)'
      && getComputedStyle(item).outlineStyle === 'none'
  })()`),
    'the first Ctrl-click paints the focused card immediately without an outer outline',
  )
  await pointerClick('.compare .alias-item', true)
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 2)
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('#creation-editor .textarea-token-highlights mark')].map(mark => mark.textContent)`,
    ),
    ['masterpiece', 'twin tails'],
  )
  writeFileSync(
    join(profile, 'ctrl-text-highlights.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  assert.equal(await js(`!!document.querySelector('.token-selection-actions')`), false)
  await pointerClick('.compare .alias-item', true)
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 1)
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('#creation-editor .textarea-token-highlights mark')].map(mark => mark.textContent)`,
    ),
    ['masterpiece'],
  )
  await pointerClick('.compare .valid-wrap .tag-card', true)
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 0)
  assert.equal(await js(`!!document.querySelector('.textarea-token-highlights')`), false)
  await js(`document.querySelector('.compare .valid-wrap .tag-card').click()`)
  await js(
    `document.querySelector('.compare .alias-item').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
  )
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 1)
  await js(
    `document.querySelector('.compare .alias-item').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
  )
  assert.equal(await js(`document.querySelectorAll('.compare .token-selected').length`), 0)
  await pointerClick('.compare .valid-wrap .tag-card', true)
  await js(
    `document.querySelector('.compare .unknown-head').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
  )
  await js(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`,
  )
  assert.equal(await value(), 'twin tails', 'batch deletion removes only selected occurrences')
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'masterpiece, twin tails, bogus', 'batch deletion is one native undo')
  await edit(base, Array(70).fill('masterpiece').join(',\n') + ',\nbogus')
  await waitUI(`document.querySelector('.compare .unknown-head')?.textContent.includes('bogus')`)
  await js(`document.querySelector('#creation-editor').scrollTop = 0`)
  await pointerClick('.compare .unknown-head', true)
  assert.equal(
    await js(`document.querySelector('#creation-editor').scrollTop`),
    0,
    'Ctrl selecting an offscreen token never scrolls the editor',
  )
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.textarea-token-highlights mark')].map(mark => mark.textContent)`,
    ),
    ['bogus'],
  )
  await js(`document.querySelector('.compare .unknown-head').click()`)
  await waitUI(`document.querySelector('#creation-editor').scrollTop > 100`)
  await new Promise((resolve) => setTimeout(resolve, 550))
  const locatedScroll = await js(`document.querySelector('#creation-editor').scrollTop`)
  assert.ok(
    await js(`(() => {
    const input = document.querySelector(${JSON.stringify(base)})
    const panel = document.querySelector('#creation-editor').getBoundingClientRect()
    const box = input.getBoundingClientRect()
    const textBottom = box.bottom - parseFloat(getComputedStyle(input).paddingBottom)
    const textCenter = textBottom - parseFloat(getComputedStyle(input).lineHeight) / 2
    return input.value.slice(input.selectionStart, input.selectionEnd) === 'bogus'
      && textBottom <= panel.bottom + 4 && textBottom > panel.top
      && Math.abs(textCenter - (panel.top + panel.bottom) / 2) < 36
  })()`),
    'long text locates the token itself inside the editor viewport',
  )
  await js(`document.querySelector('.compare .unknown-head').click()`)
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.ok(
    Math.abs((await js(`document.querySelector('#creation-editor').scrollTop`)) - locatedScroll) <
      2,
    'clicking a visible token leaves editor scroll unchanged',
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
        const bounds = row.getBoundingClientRect()
        return !row.classList.contains('scroll-row') && getComputedStyle(row).flexWrap === 'wrap'
          && row.scrollWidth <= row.clientWidth + 1
          && [...row.children].every(child => {
            const rect = child.getBoundingClientRect()
            return rect.left >= bounds.left && rect.right <= bounds.right + 1
              && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1
          })
      })`),
      'tab rows display every item fully and wrap without horizontal scrolling',
    )
    assert.ok(
      await js(`(() => {
        const row = document.querySelector('.compare .section-tabs')
        const samples = Array.from({ length: 12 }, (_, index) => {
          const chip = row.firstElementChild.cloneNode(true)
          chip.textContent = '角色 ' + (index + 1) + ' 负面 26'
          row.append(chip)
          return chip
        })
        const bounds = row.getBoundingClientRect()
        const fits = row.scrollWidth <= row.clientWidth + 1 && samples.every(chip => {
          const rect = chip.getBoundingClientRect()
          return rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1
        }) && new Set(samples.map(chip => chip.offsetTop)).size > 1
        samples.forEach(chip => chip.remove())
        return fits
      })()`),
      'long character lists use multiple complete rows',
    )
    writeFileSync(
      join(profile, `creation-check-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
    await require('./generation-popover-checks.cjs')({ js, waitUI, win, profile, width })
  }

  await panel('ai')
  assert.ok(
    await js(
      `getComputedStyle(document.querySelector('.creation-request-pane')).backgroundColor === getComputedStyle(document.querySelector('.creation-results')).backgroundColor`,
    ),
    'AI request area shares the page background',
  )
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 180))
    assert.ok(
      await js(`(() => {
      const bar = document.querySelector('.creation-toolbar').getBoundingClientRect()
      const action = document.querySelector('.creation-ai-actions').getBoundingClientRect()
      return action.width > 0 && action.top >= bar.top && action.bottom <= bar.bottom
        && action.right <= innerWidth && bar.height <= 88
        && !document.querySelector('.ai .pane-foot') && !document.querySelector('.creation-ai-actions .kbd')
        && getComputedStyle(document.querySelector('.creation-preview-actions')).display === 'none'
    })()`),
      'AI action shares the header without a duplicate footer or inactive preview controls',
    )
    writeFileSync(
      join(profile, `creation-ai-header-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  assert.equal(await js(`document.querySelectorAll('.ai textarea[data-src]').length`), 0)
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(`document.querySelector('.ai .cheer .actions .primary')`)
  await edit(base, 'sunlight, garden')
  await js(`document.querySelector('.ai .cheer .actions .primary').click()`)
  assert.equal(await value(), 'sunlight, garden', 'stale AI result cannot overwrite edits')
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(`document.querySelector('.ai .cheer .actions .primary')`)
  await js(`document.querySelector('.ai .cheer .actions .primary').click()`)
  await waitUI(`document.querySelector(${JSON.stringify(base)}).value === 'outdoors'`)
  await click('.ai .cheer button', '撤销采用')
  assert.equal(await value(), 'sunlight, garden')

  await panel('preview')
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 180))
    assert.ok(
      await js(`(() => {
      const bar = document.querySelector('.creation-toolbar').getBoundingClientRect()
      const action = document.querySelector('.creation-preview-actions').getBoundingClientRect()
      return bar.height <= 88 && action.top >= bar.top && action.bottom <= bar.bottom
        && action.right <= innerWidth && !document.querySelector('.creation-preview-actions .kbd')
        && document.querySelectorAll('.preview .pane-foot').length === 0
    })()`),
      'forecast controls fit in the tab header without a second action panel',
    )
    writeFileSync(
      join(profile, `creation-forecast-header-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.creation-tab')].map(button => button.textContent.trim())`,
    ),
    ['词条检查', '智能优化', '画面推测', '图片预览'],
  )
  assert.equal(await js(`document.querySelectorAll('.preview textarea').length`), 0)
  await js(`document.querySelector('.creation-preview-actions .run-bar .btn.accent').click()`)
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
    '生图创作',
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
  // 生成进行中：创作实验底栏只保留「停止」，不能重复提交
  assert.equal(
    await js(`!!document.querySelector('.creation-generation .run-bar .btn.accent')`),
    false,
  )
  release()
  await waitUI(
    `!!document.querySelector('.generate .viewer') && !!document.querySelector('.creation-generation .run-bar .btn.accent')`,
  )
  assert.equal(calls, 1)
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
  // 词条检查、智能优化、画面推测、图片预览只在创作实验里提供，侧栏不再有独立入口
  assert.equal(
    await js(
      `[...document.querySelectorAll('.nav-item')].filter(e=>/提示词比对|AI 优化|画面推测|生图预览/.test(e.textContent)).length`,
    ),
    0,
  )
  await panel('preview')
  assert.equal(
    await js(
      `document.querySelector('.preview').textContent.includes('想要的效果') || document.querySelector('.preview').textContent.includes('带着建议去 AI 优化')`,
    ),
    false,
    'forecast no longer hands suggestions to AI optimize',
  )
  console.log(
    'PASS creation shares controllers and undo, keeps forecasting separate from edits, preserves old review, generation lock, image restoration and layout',
  )
}
