const { app } = require('electron')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { temporaryProfile } = require('../support/fixtures.cjs')

// Real bundled tag database; completion must stay fast enough to run on every pause in typing.
const root = resolve(__dirname, '../..')
app.setPath('userData', temporaryProfile('np-tag-complete-'))
app.getAppPath = () => root
require('../support/register-typescript.cjs')

app.whenReady().then(() => {
  try {
    const { tagStore } = require('../../src/main/modules/tags/store.ts')
    tagStore.load()
    assert.ok(tagStore.status().tagCount > 100000, 'bundled tag database is loaded')
    const names = (query) => tagStore.complete(query, 8).map((hit) => hit.name)
    assert.deepEqual(tagStore.complete('b'), [], 'single letters are too broad to suggest')
    assert.equal(names('twi')[0], 'twintails')
    assert.equal(
      tagStore.complete('ha', 100).length,
      100,
      'larger configured result sets are supported',
    )
    assert.equal(names('blue h')[0], 'blue_hair')
    assert.ok(names('long ha').includes('long_hair'))
    assert.ok(names('蓝').includes('blue_eyes'), 'Chinese translations are matched')
    assert.ok(
      tagStore.complete('twin tai').some((hit) => hit.name === 'twintails' && hit.viaAlias),
      'aliases complete to their canonical tag',
    )
    const artists = tagStore.complete('wl', 8, 1)
    assert.ok(artists.length > 0, 'artist: completion finds artists')
    assert.ok(
      artists.every((hit) => hit.category === 1),
      'a category filter only returns that category',
    )
    assert.equal(names('very a')[0], 'very_aesthetic', 'NovelAI tags rank first')
    let worst = 0
    for (const query of [
      'sa',
      'bl',
      'blu',
      'blue h',
      'hai',
      'long ha',
      'sm',
      'tw',
      'mast',
      '蓝',
      '长发',
    ]) {
      const start = performance.now()
      tagStore.complete(query)
      tagStore.complete(query, 8, 1)
      worst = Math.max(worst, performance.now() - start)
    }
    assert.ok(worst < 40, `completion stays fast after indexing (worst ${worst.toFixed(1)}ms)`)
    console.log(
      `PASS prefix, alias, pinyin, Chinese, artist-only and NovelAI-first completion; worst query ${worst.toFixed(1)}ms`,
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
