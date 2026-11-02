const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function checkGenerationPopover({ js, waitUI, win, profile, width }) {
  const toggle = '#creation-generation-controls .creation-parameters-toggle'
  const popup = '#creation-generation-settings'
  assert.ok(
    await js(`(() => {
    const selectors = ['.creation-parameters-toggle', '.dock-collection', '.dock-retention', '.fee-status', '.pane-foot']
    const rects = selectors.map(selector => document.querySelector('#creation-generation-controls ' + selector).getBoundingClientRect())
    const centers = rects.map(r => r.top + r.height / 2)
    const dock = document.querySelector('#creation-generation-controls').getBoundingClientRect()
    return Math.max(...centers) - Math.min(...centers) < 2 && dock.height <= 52 && rects.every((r, i) => r.left >= dock.left && r.right <= dock.right && (!i || r.left >= rects[i - 1].right))
  })()`),
    'all generation controls fit on one compact row',
  )
  assert.equal(
    await js(`!!document.querySelector('#creation-generation-controls button .fee-status')`),
    false,
  )
  assert.ok(
    await js(
      `['#creation-editor', '.creation-panels'].every(selector => getComputedStyle(document.querySelector(selector)).scrollbarGutter === 'auto')`,
    ),
    'scrollbars do not reserve empty space',
  )
  assert.equal(
    await js(`document.querySelector('${toggle}').textContent.trim()`),
    '',
    'settings uses an icon without configuration summaries',
  )
  const before = await js(
    `document.querySelector('#creation-editor').getBoundingClientRect().height`,
  )
  await js(`document.querySelector('${toggle}').click()`)
  await waitUI(`!!document.querySelector('[data-generation-settings-open]')`)
  assert.ok(
    await js(`(() => {
    const panel = document.querySelector('${popup}').getBoundingClientRect()
    const dock = document.querySelector('#creation-generation-controls').getBoundingClientRect()
    const results = document.querySelector('.creation-results').getBoundingClientRect()
    return panel.width > 250 && panel.height > 200 && panel.top >= 56
      && panel.bottom < dock.top && panel.right <= results.left
      && Math.abs(dock.right - results.left) <= 1 && Math.abs(results.bottom - innerHeight) <= 1
      && document.querySelector('${popup}').scrollWidth <= document.querySelector('${popup}').clientWidth + 1
  })()`),
    'popover stays above the left dock without obscuring results or overflowing',
  )
  assert.equal(
    await js(`document.querySelector('#creation-editor').getBoundingClientRect().height`),
    before,
  )
  await js(
    `(() => { const input = document.querySelector('${popup} input[aria-label="种子"]'); input.value = '314'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  )
  await js(`document.querySelector('${popup} details').open = true`)
  await js(`document.querySelector('${popup} [aria-label="采样器"]').click()`)
  await waitUI(`!!document.querySelector('.theme-select-menu [role="option"]')`)
  await js(`(() => {
    const option = [...document.querySelectorAll('.theme-select-menu [role="option"]')].find(node => node.querySelector('span').textContent.trim() === 'Euler')
    option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    option.click()
  })()`)
  await waitUI(
    `document.querySelector('${popup} [aria-label="采样器"]').textContent.includes('Euler') && !!document.querySelector('[data-generation-settings-open]')`,
  )
  await js(`document.querySelector('${popup}').scrollTop = 0`)
  await new Promise((resolve) => setTimeout(resolve, 200))
  writeFileSync(
    join(profile, `generation-popover-${width}.png`),
    (await win.webContents.capturePage()).toPNG(),
  )
  // Escape first dismisses settings, leaving page-level run/cancel shortcuts untouched.
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitUI(`!document.querySelector('[data-generation-settings-open]')`)
  await js(`document.querySelector('${toggle}').click()`)
  await waitUI(`!!document.querySelector('[data-generation-settings-open]')`)
  assert.equal(await js(`document.querySelector('${popup} input[aria-label="种子"]').value`), '314')
  assert.ok(
    await js(
      `document.querySelector('${popup} [aria-label="采样器"]').textContent.trim() === 'Euler'`,
    ),
  )
  await js(
    `document.querySelector('#creation-editor').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
  )
  await waitUI(`!document.querySelector('[data-generation-settings-open]')`)
  assert.equal(
    await js(`document.querySelector('#creation-editor').getBoundingClientRect().height`),
    before,
  )
}
