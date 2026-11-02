const assert = require('node:assert/strict')
const { app } = require('electron')
const { join } = require('node:path')
const { readFileSync, existsSync } = require('node:fs')
const { PNG } = require('pngjs')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-collections-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
app.whenReady().then(() => {
  try {
    const {
      CollectionStore,
      imageCollections,
    } = require('../../src/main/modules/images/collections.ts')
    const library = require('../../src/main/modules/images/library.ts')
    const path = join(profile, 'data/image-collections.json')
    const set = imageCollections.create('角色练习')
    assert.throws(() => imageCollections.create(' 角色练习 '), /同名/)
    assert.throws(() => imageCollections.remove('default'), /默认/)
    assert.throws(() => imageCollections.assign(['../bad.png'], set.id), /标识/)
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(255)
    const recipe = {
      schema: 1,
      createdAt: Date.now(),
      sourceKind: 'generate',
      request: {
        base: 'cat',
        negative: '',
        characters: [],
        version: 'v5',
        params: {
          width: 64,
          height: 64,
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
    const img = library.storeGeneratedImage(
      PNG.sync.write(png),
      recipe,
      'temporary',
      undefined,
      set.id,
    )
    assert.equal(img.collectionId, set.id)
    const before = readFileSync(library.libraryImagePath(img.name))
    const retained = library.retainImage(img.name)
    assert.equal(retained.storage, 'saved')
    assert.equal(retained.collectionId, set.id)
    imageCollections.rename(set.id, '角色研究')
    assert.equal(new CollectionStore(() => path).list()[1].name, '角色研究')
    assert.equal(new CollectionStore(() => path).forImage(img.name), set.id)
    imageCollections.remove(set.id)
    assert.equal(library.imageInfo(img.name).collectionId, 'default')
    assert.deepEqual(readFileSync(library.libraryImagePath(img.name)), before)
    assert.ok(existsSync(library.libraryImagePath(img.name)))
    assert.equal(library.readImageRecipe(img.name).request.base, 'cat')
    const legacy = library.storeGeneratedImage(PNG.sync.write(png), recipe, 'saved')
    assert.equal(legacy.collectionId, 'default')
    const stale = library.storeGeneratedImage(
      PNG.sync.write(png),
      recipe,
      'saved',
      undefined,
      set.id,
    )
    assert.equal(
      stale.collectionId,
      'default',
      'deleted selection falls back without losing generated image',
    )
    console.log(
      'PASS collection CRUD/persistence, default and stale fallback, retention preserves grouping, grouping never mutates PNG or embedded recipe',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
