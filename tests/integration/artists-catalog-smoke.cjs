require('../support/register-typescript.cjs')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  normalizeArtistCodex,
  queryArtistCatalog,
} = require('../../src/main/modules/artists/catalog.ts')
const { fetchArtistCodex } = require('../../src/main/providers/quicktagcloud.ts')

const entry = (id, tags, extra = {}) => ({ id, title: id, tags, image: `${id}.jpg`, ...extra })
const fixture = {
  version: 'fixture',
  entries: [
    entry('one', 'artist:wlop', { assetCodexId: 'artist_300' }),
    entry('two', 'artist:anmi, year 2025', { rating: 'safe' }),
    entry('mixed', 'artist:wlop, artist:anmi'),
    entry('restricted', 'artist:hidden', { rating: 'restricted' }),
    entry('traversal', 'artist:hidden', { image: '../file.jpg' }),
    entry('remote', 'artist:hidden', { image: 'https://elsewhere.test/picture.jpg' }),
    ...Array.from({ length: 25 }, (_, index) => entry(`extra${index}`, `artist:extra${index}`)),
  ],
}
const normalized = normalizeArtistCodex(fixture, 'v4.5')
assert.equal(normalized.entries.length, 27)
assert.equal(
  normalized.entries[0].image,
  'https://assets.quicktagcloud.com/images/artist_300/one.jpg',
)
assert.equal(normalized.entries[1].name, 'anmi')
const bytes = Buffer.from(JSON.stringify(fixture))
const hash = createHash('sha256').update(bytes).digest('hex')
const release = 'r2-' + 'a'.repeat(64)
let calls = 0
let fail = true
let corrupt = false
global.fetch = async (url, options) => {
  calls++
  assert.ok(url.startsWith('https://assets.quicktagcloud.com/data/'))
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers, undefined, 'never sends account credentials')
  if (fail) {
    throw new Error('fixture offline')
  }
  if (url.endsWith('/current.json')) {
    return Response.json({ release })
  }
  if (url.endsWith('/manifest.json')) {
    return Response.json({
      files: {
        'artist_nai5_personal.json': { sha256: hash },
        'artist_nai45_personal.json': { sha256: hash },
      },
    })
  }
  return new Response(corrupt ? '{}' : bytes)
}

async function main() {
  await assert.rejects(queryArtistCatalog({ version: 'v5', query: '', page: 1 }), /fixture offline/)
  fail = false
  const first = await queryArtistCatalog({ version: 'v5', query: '', page: 1 })
  assert.equal(first.total, 27)
  assert.equal(first.entries.length, 24)
  const cachedCalls = calls
  const second = await queryArtistCatalog({ version: 'v5', query: '', page: 2 })
  assert.equal(second.entries.length, 3)
  assert.equal(calls, cachedCalls, 'paging must reuse the catalog')
  const favorite = await queryArtistCatalog({
    version: 'v5',
    query: 'ANMI',
    page: 99,
    favorites: ['anmi'],
  })
  assert.equal(favorite.entries[0].name, 'anmi')
  assert.equal(favorite.page, 1)
  await queryArtistCatalog({ version: 'v4.5', query: '', page: 1 })
  assert.equal(calls, cachedCalls + 3, 'each model has its own catalog')
  await assert.rejects(queryArtistCatalog({ version: 'bad', query: '', page: 1 }), /无效/)
  corrupt = true
  await assert.rejects(fetchArtistCodex('v5'), /校验失败/)
  console.log(
    'PASS public artist catalog: model-specific cache, retries, paging, filtering, legacy schema, URL limits and integrity checks.',
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
