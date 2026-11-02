const assert = require('node:assert/strict')
module.exports = async function checkEditorRefinements({ js, waitUI }) {
  const field = '#creation-editor textarea[aria-label="主提示词"]'
  const set = (text) =>
    js(
      `(() => { const el = document.querySelector('${field}'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.focus(); })()`,
    )
  const value = () => js(`document.querySelector('${field}').value`)
  await js(`document.querySelector('#creation-tab-compare').click()`)
  await set('a, {bogus}, b')
  await waitUI(
    `!!document.querySelector('.compare .unknown-item') && document.querySelectorAll('.compare .valid-wrap').length === 2`,
  )
  await js(
    `(() => { const el = document.querySelector('.compare .tag-zh'); el.click(); el.click(); el.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); })()`,
  )
  assert.equal(
    await js(`document.querySelectorAll('.compare .zh-input, .compare .edit-hint').length`),
    0,
  )
  assert.equal(await value(), 'a, {bogus}, b')
  await js(`document.querySelector('.compare .unknown-item [title="移除"]').click()`)
  assert.equal(await value(), 'a, b')
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'a, {bogus}, b')
  await set('a, 1.2::bogus, bogus::, b')
  await waitUI(`document.querySelectorAll('.compare .unknown-item').length === 2`)
  await js(
    `[...document.querySelectorAll('.compare button')].find(el => el.textContent.trim() === '全部移除').click()`,
  )
  assert.equal(await value(), 'a, b')
  await set('a, {{best quality}}')
  await waitUI(
    `document.querySelectorAll('.compare .valid-wrap').length === 2 && document.querySelector('.compare .tag-grid').textContent.includes('best quality')`,
  )
  assert.equal(await js(`document.querySelectorAll('.compare .remove-valid').length`), 0)
  await js(
    `document.querySelectorAll('.compare .tag-card')[1].click(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Backspace', bubbles:true, cancelable:true }))`,
  )
  assert.equal(
    await value(),
    'a',
    'click-to-locate then Backspace removes empty wrappers and trailing comma',
  )
  await js(`document.execCommand('undo')`)
  assert.equal(await value(), 'a, {{best quality}}')
  assert.equal(
    await js(
      `(() => { const el = document.querySelector('${field}'); el.setSelectionRange(0, 1); return el.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', shiftKey:true, bubbles:true, cancelable:true})); })()`,
    ),
    true,
    'Shift+Delete stays a native cut action',
  )
  const retention = '#creation-generation-controls .dock-retention input'
  const before = await js(`document.querySelector('${retention}').checked`)
  await js(`document.querySelector('${retention}').click()`)
  await waitUI(`!document.querySelector('${retention}').disabled`)
  assert.equal(await js(`(async () => (await window.api.getSettings()).naiAutoSave)()`), !before)
  await js(`document.querySelector('.creation-parameters-toggle').click()`)
  assert.equal(
    await js(`document.querySelectorAll('#creation-generation-settings .retention-toggle').length`),
    0,
  )
  await js(
    `window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'})); document.querySelector('${retention}').click()`,
  )
  await waitUI(`!document.querySelector('${retention}').disabled`)
  assert.equal(await js(`(async () => (await window.api.getSettings()).naiAutoSave)()`), before)
  console.log(
    'PASS tag clicks cannot edit translation; weighted individual/bulk deletion preserves undo; dock retention saves independently of settings popover',
  )
}
