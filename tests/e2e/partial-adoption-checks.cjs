const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
module.exports = async function checkPartialUi({
  js,
  click,
  waitUI,
  setOptimizeResult,
  profile,
  win,
}) {
  await click('.nav-item', '创作实验')
  await js(`document.querySelector('#creation-tab-ai').click()`)
  const field = (label) => `#creation-editor textarea[aria-label="${label}"]`
  const edit = (label, value) =>
    js(
      `(() => { const el = document.querySelector(${JSON.stringify(field(label))}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    )
  const value = (label) => js(`document.querySelector(${JSON.stringify(field(label))}).value`)
  await edit('主提示词', 'red hair, blue eyes')
  await waitUI(`document.querySelector('.ai .request-field').tagName === 'DETAILS'`)
  await js(`document.querySelector('.ai .request-field').open = false`)
  assert.equal(await js(`document.querySelector('.ai .request-field').open`), false)
  await js(`document.querySelector('.ai .request-summary').click()`)
  await js(`(() => {
    const input = document.querySelector('.ai .composer textarea')
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  for (const content of ['', '保留这段修改要求']) {
    await js(`(() => {
      const input = document.querySelector('.ai .composer textarea')
      input.value = ${JSON.stringify(content)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    for (let i = 0; i < 4; i++) {
      await js(`document.querySelector('.ai .fresh-toggle input').click()`)
      await waitUI(
        `document.querySelector('.creation-ai-actions .btn.accent').textContent.includes('${i % 2 === 0 ? '生成提示词' : '优化提示词'}')`,
      )
      assert.equal(
        await js(`document.querySelector('.ai .request-field').open`),
        true,
        'switching regeneration on/off keeps the request editor expanded even when empty',
      )
      assert.equal(await js(`document.querySelector('.ai .composer textarea').value`), content)
    }
  }
  await js(`document.querySelector('.ai .request-summary').click()`)
  await waitUI(`!document.querySelector('.ai .request-field').open`)
  await js(`document.querySelector('.ai .request-summary').click()`)
  await edit('负面提示词', 'lowres')
  await js(
    `(() => { const el = document.querySelector('.ai .composer textarea'); el.value = '改成银发、绿眼，调整负面词'; el.dispatchEvent(new Event('input', { bubbles:true })); })()`,
  )
  setOptimizeResult((req) => ({
    positive: 'silver hair, green eyes',
    negative: 'bad anatomy',
    characters: req.characters,
    changes: [
      {
        scope: 'positive',
        text: '将发色与瞳色分别调整为银色和绿色。',
        basis: 'taste',
        evidence: '',
      },
      { scope: 'negative', text: '将负面词调整为身体结构约束。', basis: 'rule', evidence: '' },
    ],
    invalid: [],
    notes: '本次调整全局外观描述及负面词，角色与位置保持不变。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(`!!document.querySelector('#ai-review-compare')`)
  assert.equal(
    await js(`!!document.querySelector('#ai-review-tab-notes, .review-description[title]')`),
    false,
  )
  assert.equal(await js(`document.querySelectorAll('#ai-review-compare .diff-context').length`), 0)
  assert.equal(await js(`!!document.querySelector('#ai-review-tab-partial')`), false)
  await waitUI(`document.querySelectorAll('.review-scopes button').length === 2`)
  assert.equal(await js(`document.querySelectorAll('#ai-review-compare .review-field').length`), 1)
  assert.equal(
    await js(
      `document.querySelectorAll('#ai-review-compare details, #ai-review-compare summary, #ai-review-compare .review-field-head, #ai-review-compare .review-display').length`,
    ),
    0,
  )
  await waitUI(`document.querySelectorAll('.ai-change').length === 2`)
  const hair = `[...document.querySelectorAll('.ai-change')].find(el => el.querySelector('ins')?.textContent === 'silver hair')`
  await js(`${hair}.click()`)
  assert.equal(await value('主提示词'), 'silver hair, blue eyes')
  assert.equal(await js(`${hair}.getAttribute('aria-pressed')`), 'true')
  assert.equal(
    await js(`${hair}.textContent.includes('采纳') || ${hair}.textContent.includes('（删除）')`),
    false,
  )
  await js(`document.querySelector('.ai .request-summary').click()`)
  await waitUI(`!document.querySelector('.ai .request-field').open`)
  // Import toasts with an undo action can last up to 11s; don't tie screenshots to the 4s UI timeout.
  const toastDeadline = Date.now() + 12000
  while (await js(`!!document.querySelector('.toast')`)) {
    assert.ok(Date.now() < toastDeadline, 'toast should clear before the comparison screenshot')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 200))
    writeFileSync(
      join(profile, `ai-review-compare-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  assert.ok(
    await js(
      `document.querySelector('#ai-review-compare').textContent.includes('red') && document.querySelector('#ai-review-compare').textContent.includes('silver')`,
    ),
  )
  assert.ok(
    await js(`document.querySelector('#ai-review-compare').textContent.includes('将发色与瞳色')`),
  )
  await js(`document.querySelectorAll('.review-scopes button')[1].click()`)
  assert.ok(
    await js(
      `document.querySelector('#ai-review-compare').textContent.includes('身体结构约束') && !document.querySelector('#ai-review-compare').textContent.includes('将发色与瞳色')`,
    ),
  )
  await js(`document.querySelector('.review-scopes button').click()`)
  assert.equal(await js(`${hair}.getAttribute('aria-pressed')`), 'true')
  assert.equal(await value('负面提示词'), 'lowres')
  await click('.ai .right .row button', '推测当前画面')
  assert.equal(
    await value('主提示词'),
    'silver hair, blue eyes',
    'navigation must not adopt the remaining changes',
  )
  await js(`document.querySelector('#creation-tab-ai').click()`)
  await edit('负面提示词', 'manual negative')
  await js(`${hair}.click()`)
  assert.equal(await value('主提示词'), 'red hair, blue eyes')
  assert.equal(await value('负面提示词'), 'manual negative')
  assert.equal(await js(`${hair}.getAttribute('aria-pressed')`), 'false')
  await js(`${hair}.click()`)
  await js(`document.getAnimations().forEach(a => { try { a.finish() } catch {} })`)
  await new Promise((resolve) => setTimeout(resolve, 200))
  writeFileSync(
    join(profile, 'partial-adoption.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  await edit('主提示词', 'silver hair, blue eyes, smiling')
  await js(`${hair}.click()`)
  assert.equal(
    await value('主提示词'),
    'silver hair, blue eyes, smiling',
    'undo cannot overwrite subsequent edits',
  )
  assert.equal(await js(`${hair}.getAttribute('aria-pressed')`), 'true')
  assert.equal(await js(`document.querySelectorAll('.ai .timeline').length`), 0)
  // Exercise real inline structural actions and ensure middle insertion preserves later roles.
  const characterValues = () =>
    js(
      `[...document.querySelectorAll('#creation-editor .char-block .composer:not(.neg) textarea')].map(el => el.value)`,
    )
  const originalRoles = await characterValues()
  setOptimizeResult((req) => ({
    positive: req.prompt,
    negative: req.negative,
    characters: [
      req.characters[0],
      { prompt: 'cat, white fur', negative: '', position: 'C3' },
      ...req.characters.slice(1),
    ],
    changes: [],
    invalid: [],
    notes: '在中间新增一只猫，其他角色保持不变。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(
    `!![...document.querySelectorAll('.field-adopt')].find(el => el.textContent.includes('新增角色'))`,
  )
  const add = `[...document.querySelectorAll('.field-adopt')].find(el => el.textContent.includes('新增角色'))`
  await js(`${add}.click()`)
  assert.deepEqual(await characterValues(), [
    originalRoles[0],
    'cat, white fur',
    ...originalRoles.slice(1),
  ])
  await js(`${add}.click()`)
  assert.deepEqual(await characterValues(), originalRoles)
  await js(`${add}.click()`)
  setOptimizeResult((req) => ({
    positive: req.prompt,
    negative: req.negative,
    characters: req.characters.filter((_, i) => i !== 1),
    changes: [],
    invalid: [],
    notes: '删除中间的猫。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(
    `!![...document.querySelectorAll('.field-adopt')].find(el => el.textContent.includes('移除角色'))`,
  )
  await js(
    `[...document.querySelectorAll('.field-adopt')].find(el => el.textContent.includes('移除角色')).click()`,
  )
  assert.deepEqual(await characterValues(), originalRoles)
  // Position changes are collected in their own scope, adopt per role and open a before/after map.
  const positions = () =>
    js(
      `[...document.querySelectorAll('#creation-editor .char-block input.input.sm')].map(el => el.value)`,
    )
  const originalPositions = await positions()
  setOptimizeResult((req) => ({
    positive: req.prompt,
    negative: req.negative,
    characters: req.characters.map((c, i) => (i === 0 ? { ...c, position: 'E5' } : c)),
    changes: [],
    invalid: [],
    notes: '把第一个角色移到右下角。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(
    `!![...document.querySelectorAll('.review-scopes button')].find(el => el.textContent.includes('位置变更'))`,
  )
  assert.equal(
    await js(
      `[...document.querySelectorAll('.review-scopes button')].some(el => el.textContent.includes('· 位置'))`,
    ),
    false,
    'positions are not split into per-role tabs',
  )
  await js(
    `[...document.querySelectorAll('.review-scopes button')].find(el => el.textContent.includes('位置变更')).click()`,
  )
  await waitUI(`document.querySelectorAll('.position-row').length === 1`)
  await js(`document.querySelector('.position-row').click()`)
  assert.deepEqual(await positions(), ['E5', ...originalPositions.slice(1)])
  assert.equal(
    await js(`document.querySelector('.position-row').getAttribute('aria-pressed')`),
    'true',
  )
  assert.ok(
    await js(`!!document.querySelector('.position-row .adopt-choice-check')`),
    'adopted cards show a check; unadopted cards show none',
  )
  await js(`document.querySelector('.position-row').click()`)
  assert.deepEqual(await positions(), originalPositions)
  await click('.position-head button', '查看位置对比')
  await waitUI(`document.querySelectorAll('.position-compare figure').length === 2`)
  assert.equal(await js(`document.querySelectorAll('.position-marker.moved').length`), 2)
  assert.equal(
    await js(`document.querySelectorAll('.position-compare .position-reference').length`),
    2,
    'both canvases show the current preview image as the reference background',
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  writeFileSync(
    join(profile, 'position-compare.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  await js(`document.querySelector('[aria-label="关闭位置对比"]').click()`)
  await waitUI(`!document.querySelector('.position-compare')`)
  const oldPrompt =
    'other, pikachu, standing,\nPanel 1 at the top. The small yellow creature stands on the image right.'
  const newPrompt = oldPrompt.replace('standing,\n', 'standing, target#pointing at another,\n')
  await edit('主提示词', oldPrompt)
  setOptimizeResult((req) => ({
    positive: newPrompt,
    negative: req.negative,
    characters: req.characters,
    changes: [],
    invalid: [],
    notes: '新增互动目标动作。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(
    `!!document.querySelector('.field-adopt') && document.querySelector('#ai-review-compare').textContent.includes('target#')`,
  )
  const addition = `document.querySelector('.field-adopt')`
  await js(`${addition}.click()`)
  assert.equal(await value('主提示词'), newPrompt)
  await js(`${addition}.click()`)
  assert.equal(await value('主提示词'), oldPrompt)
  await js(`document.getAnimations().forEach(a => { try { a.finish() } catch {} })`)
  writeFileSync(
    join(profile, 'addition-classification.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  const proseBefore =
    'A quiet garden stretches behind the house. Soft morning light falls across the stone path. The girl stands beside the window with both hands resting on the wooden frame. Small white flowers grow along the wall and a tall tree casts a gentle shadow over the lawn.'
  const proseAfter =
    'A crowded city stretches beyond the balcony. Bright evening lights illuminate the streets. The girl leans against the metal railing and waves to a friend below. Colorful signs reflect on the wet pavement and moving cars fill the avenue with warm glowing trails.'
  await edit('主提示词', `1girl, ${proseBefore}`)
  await edit('负面提示词', 'lowres')
  setOptimizeResult((req) => ({
    positive: `1girl, ${proseAfter}`,
    negative: 'bad anatomy',
    characters: req.characters,
    changes: [],
    invalid: [],
    notes: '调整场景与负面词。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(`document.querySelector('#ai-review-compare').textContent.includes('crowded')`)
  assert.equal(
    await js(`document.querySelectorAll('.ai-change').length`),
    0,
    'long rewrites are not repeated as granular cards',
  )
  assert.equal(await js(`document.querySelectorAll('#ai-review-compare .review-field').length`), 1)
  await js(`document.querySelector('.field-adopt').click()`)
  assert.equal(await value('主提示词'), `1girl, ${proseAfter}`)
  assert.equal(await value('负面提示词'), 'lowres')
  await js(`document.querySelector('.field-adopt').click()`)
  assert.equal(await value('主提示词'), `1girl, ${proseBefore}`)
  await js(
    `[...document.querySelectorAll('.review-scopes button')].find(el => el.textContent.includes('负面')).click()`,
  )
  assert.ok(
    await js(
      `!document.querySelector('#ai-review-compare .prompt-review').textContent.includes('crowded')`,
    ),
  )
  await js(`document.querySelector('.field-adopt').click()`)
  assert.equal(await value('负面提示词'), 'bad anatomy')
  assert.equal(await value('主提示词'), `1girl, ${proseBefore}`)
  await js(`document.querySelector('.review-scopes button').click()`)
  assert.equal(
    await js(
      `document.querySelectorAll('#ai-review-compare .diff-context, #ai-review-compare .review-display').length`,
    ),
    0,
  )
  assert.ok(await js(`document.querySelector('#ai-review-compare').textContent.includes('1girl')`))
  const comparisonToastDeadline = Date.now() + 12000
  while (await js(`!!document.querySelector('.toast')`)) {
    assert.ok(
      Date.now() < comparisonToastDeadline,
      'previous feedback should clear before screenshot',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  for (const width of [1440, 1100]) {
    win.setSize(width, 960)
    await new Promise((resolve) => setTimeout(resolve, 200))
    writeFileSync(
      join(profile, `scoped-review-${width}.png`),
      (await win.webContents.capturePage()).toPNG(),
    )
  }
  console.log(
    'PASS flat scoped before/after comparison, complete text without repeated headers/folds and atomic long-paragraph adoption/undo',
  )
  // Prose with one rewritten sentence and one appended sentence: each is its own card.
  const sentencesBefore =
    '1girl, A quiet garden lies behind the house. Soft light falls on the path. The girl waits by the window.'
  const sentenceCat = 'A cat sleeps on the sill.'
  await edit('主提示词', sentencesBefore)
  setOptimizeResult((req) => ({
    positive: `1girl, A quiet garden lies behind the house. Warm sunset light falls on the path. The girl waits by the window. ${sentenceCat}`,
    negative: req.negative,
    characters: req.characters,
    changes: [],
    invalid: [],
    notes: '改写光线并补一句细节。',
    evidence: { related: [], wiki: [], failed: [], implications: true },
  }))
  await js(`document.querySelector('.creation-ai-actions .run-bar .btn.accent').click()`)
  await waitUI(
    `document.querySelector('#ai-review-compare')?.textContent.includes('A cat') && document.querySelectorAll('.ai-change').length === 2`,
  )
  await js(
    `[...document.querySelectorAll('.ai-change')].find(el => el.textContent.includes('A cat')).click()`,
  )
  assert.equal(await value('主提示词'), `${sentencesBefore} ${sentenceCat}`)
  await js(`document.getAnimations().forEach(a => { try { a.finish() } catch {} })`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  writeFileSync(
    join(profile, 'sentence-adoption.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  console.log('PASS single sentences in prose are adopted one by one')
  setOptimizeResult(null)
  console.log(
    'PASS per-change click applies/undoes immediately, marks adopted, preserves unrelated edits and protects manual rewrites',
  )
}
