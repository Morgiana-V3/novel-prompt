const assert = require('node:assert/strict')
const { join } = require('node:path')
const { writeFileSync, readFileSync } = require('node:fs')
const { ipcMain } = require('electron')
module.exports = async function checkStatisticsUi({ js, click, ui, win, profile, manager }) {
  const { reportUsage } = require('../../src/main/infrastructure/usage-context.ts')
  const { readTokenUsage } = require('../../src/shared/statistics/model.ts')
  const { StatisticsStore, statistics } = require('../../src/main/modules/statistics/service.ts')
  await manager.run('optimize', async () => {
    reportUsage(
      'https://fixture.invalid',
      'fixture-model',
      readTokenUsage({
        prompt_tokens: 10000,
        completion_tokens: 2345,
        total_tokens: 12345,
        prompt_cache_hit_tokens: 8000,
      }),
    )
  })
  await js(
    `if (document.querySelector('.task-trigger').getAttribute('aria-expanded') !== 'true') document.querySelector('.task-trigger').click()`,
  )
  await ui(
    `document.querySelector('.task-card[data-kind="optimize"] .task-usage')?.textContent.includes('12,345')`,
  )
  assert.equal(await js(`document.querySelector('.task-usage-details').open`), false)
  assert.ok(
    await js(
      `document.querySelector('.task-steps').compareDocumentPosition(document.querySelector('.task-usage-details')) & Node.DOCUMENT_POSITION_FOLLOWING`,
    ),
  )
  await js(`document.querySelector('.task-usage-details summary').click()`)
  assert.ok(
    await js(
      `document.querySelector('.task-card[data-kind="optimize"] .task-usage').textContent.includes('8,000')`,
    ),
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(await js(`getComputedStyle(document.querySelector('.task-panel')).opacity`), '1')
  writeFileSync(
    join(profile, 'task-token-usage.png'),
    (await win.webContents.capturePage()).toPNG(),
  )
  await js(`document.querySelector('.task-trigger').click()`)
  const filename = join(profile, 'statistics-ui.json')
  const now = new Date()
  let date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 12)
  const store = new StatisticsStore(
    () => filename,
    () => date,
  )
  for (let i = 0; i < 7; i++) {
    date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i, 12)
    store.ai({
      provider: 'https://fixture.invalid',
      model: 'fixture-model',
      feature: 'optimize',
      usage: readTokenUsage({
        prompt_tokens: 10000 + i * 2000,
        completion_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 8000 },
      }),
    })
    store.record('optimize', (totals) => {
      totals.runs += i + 1
      totals.completed += i + 1
    })
    store.record('generate', (totals) => {
      totals.anlasSpent += i * 10
      totals.anlasMeasured++
    })
    store.record(
      'generate',
      (totals) => {
        totals.images += i * 2
        totals.runs++
        totals.completed++
      },
      { provider: 'NovelAI', model: 'v5' },
    )
  }
  ipcMain.removeHandler('statistics:get')
  ipcMain.removeHandler('statistics:clear')
  ipcMain.handle('statistics:get', () => store.snapshot())
  ipcMain.handle('statistics:clear', () => store.clear())
  try {
    await click('.nav-item', '设置 / 数据')
    await js(`document.querySelector('#settings-tab-statistics').click()`)
    await ui(`document.querySelector('.statistics-counters')?.textContent.includes('119,000')`)
    assert.ok(
      await js(`document.querySelector('.statistics-counters').textContent.includes('210')`),
    )
    assert.ok(
      await js(
        `document.querySelector('#settings-tab-statistics').getBoundingClientRect().top < document.querySelector('#settings-tab-other').getBoundingClientRect().top`,
      ),
    )
    assert.equal(await js(`document.querySelectorAll('.statistics-chart button').length`), 30)
    await js(
      `[...document.querySelectorAll('.statistics-toolbar button')].find(el => el.textContent.trim() === '7 天').click()`,
    )
    assert.equal(await js(`document.querySelectorAll('.statistics-chart button').length`), 7)
    await js(
      `[...document.querySelectorAll('.statistics-toolbar button')].find(el => el.textContent.trim() === 'Anlas').click()`,
    )
    assert.ok(
      await js(
        `document.querySelector('.statistics-chart').getAttribute('aria-label').includes('Anlas')`,
      ),
    )
    await js(
      `[...document.querySelectorAll('.statistics-toolbar button')].find(el => el.textContent.trim() === '图片').click(); document.querySelector('.statistics-chart button').click()`,
    )
    assert.ok(await js(`document.querySelector('.statistics-day').textContent.includes('图片 0')`))
    for (const width of [1440, 1100]) {
      win.setSize(width, 960)
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.ok(
        await js(
          `document.querySelector('.settings-content').scrollWidth <= document.querySelector('.settings-content').clientWidth + 1`,
        ),
      )
      writeFileSync(
        join(profile, `statistics-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      )
    }
    await js(
      `document.querySelector('#settings-tab-services').click(); document.querySelector('#settings-service-ai').click()`,
    )
    await ui(`document.querySelector('.statistics-summary')?.textContent.includes('119,000')`)
    await js(`document.querySelector('.statistics-summary button').click()`)
    await ui(`!!document.querySelector('.statistics-settings')`)
    await js(
      `[...document.querySelectorAll('.statistics-header button')].find(el => el.textContent.trim() === '清空统计').click()`,
    )
    await ui(`!!document.querySelector('dialog[open]')`)
    await js(
      `[...document.querySelectorAll('dialog button')].find(el => el.textContent.trim() === '取消').click()`,
    )
    assert.ok(store.snapshot().days.length)
    await js(
      `[...document.querySelectorAll('.statistics-header button')].find(el => el.textContent.trim() === '清空统计').click()`,
    )
    await ui(`!!document.querySelector('dialog[open]')`)
    await js(`document.querySelector('dialog .danger').click()`)
    await ui(`document.querySelector('.statistics-counters strong').textContent === '0'`)
    assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')).days, [])
    assert.ok(manager.snapshot().tasks.length, 'reset preserves task history')
    console.log(
      'PASS per-task Token display, statistics navigation/summary, daily chart selection, width layouts, clear cancellation and persisted reset',
    )
  } finally {
    ipcMain.removeHandler('statistics:get')
    ipcMain.removeHandler('statistics:clear')
    ipcMain.handle('statistics:get', () => statistics.snapshot())
    ipcMain.handle('statistics:clear', () => statistics.clear())
  }
}
