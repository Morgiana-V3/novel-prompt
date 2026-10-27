const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Offline integration: isolated profile, real persistence, no paid/network calls.
const { app, net } = require('electron')
const fs = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-retention-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const library = require('../../src/main/modules/images/library.ts')
const client = require('../../src/main/modules/generation/index.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
const { renderPage, discussPage } = require('../../src/main/modules/workspace/collaboration.ts')
const { pageCurrent, pageIteration } = require('../../src/shared/workspace/model.ts')
const recipes = require('../../src/main/modules/images/recipes.ts')
const { saveSettings } = require('../../src/main/modules/settings/service.ts')
const params = {
  width: 64,
  height: 64,
  steps: 1,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 0,
  count: 1,
  qualityTags: false,
  ucPreset: 'none',
}
const req = { base: 'cat', negative: 'blurry', characters: [], version: 'v5', params }
const png = new PNG({ width: 64, height: 64 })
png.data.fill(255)
const bytes = PNG.sync.write(png)
let flip = null
let calls = 0
let aiInput
net.fetch = async (url, init) => {
  if (url.endsWith('/user/subscription')) {
    return Response.json({
      active: true,
      tier: 3,
      trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 0 },
      usage: { percent: 80, isNegative: false },
    })
  }
  if (url.endsWith('/chat/completions')) {
    aiInput = JSON.parse(JSON.parse(init.body).messages[1].content[0].text)
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ reply: 'Only text is available.', proposal: null }),
          },
        },
      ],
    })
  }
  assert.equal(url, 'https://image.novelai.net/ai/generate-image')
  calls++
  if (flip !== null) {
    saveSettings({ naiAutoSave: flip })
    flip = null
  }
  return new Response(bytes, { headers: { 'content-type': 'image/png' } })
}
app.whenReady().then(async () => {
  try {
    saveSettings({
      naiToken: 'fixture',
      naiFreeOnly: true,
      naiAutoSave: false,
      apiKey: 'fixture',
      baseUrl: 'https://fixture.test/v1',
    })
    const configRequest = {
      ...req,
      params: { ...params, count: 4, seed: 12345, qualityTags: true, ucPreset: 'light' },
    }
    const configFavorite = recipes.createConfigRecipe(configRequest)
    assert.deepEqual(
      configFavorite.recipe.request,
      configRequest,
      'current config preserves full settings including count, seed and presets',
    )
    configRequest.params.seed = 999
    assert.equal(
      recipes.listRecipes().find((r) => r.id === configFavorite.id).recipe.request.params.seed,
      12345,
      'favorite is an independent persistent snapshot',
    )
    assert.equal(configFavorite.thumbnail, '')
    assert.equal(configFavorite.sourceImage, '')
    assert.throws(
      () => recipes.createConfigRecipe({ ...req, params: { ...params, count: 999 } }),
      /张数或提示词预设无效/,
    )
    recipes.deleteRecipe(configFavorite.id)
    flip = true
    const a = await client.generateImages(
      { ...req, params: { ...params, count: 2 } },
      () => {},
      () => false,
    )
    assert.equal(a.images.length, 2)
    assert.ok(a.images.every((i) => i.storage === 'temporary'))
    assert.equal(library.readImageRecipe(a.images[0].name).request.params.seed, 0)
    assert.equal(library.readImageRecipe(a.images[1].name).request.params.seed, 1)
    flip = false
    const b = await client.generateImages(
      { ...req, params: { ...params, count: 2 } },
      () => {},
      () => false,
    )
    assert.ok(b.images.every((i) => i.storage === 'saved'))
    const retained = library.retainImage(a.images[0].name)
    assert.equal(retained.storage, 'saved')
    assert.equal(library.retainImage(retained.name).name, retained.name)
    assert.equal(library.imageInfo(a.images[1].name).storage, 'temporary')
    const tempDir = join(profile, 'image-library', 'temporary')
    const stale = '11111111-1111-4111-8111-111111111111.png'
    const unlocked = '22222222-2222-4222-8222-222222222222.png'
    fs.writeFileSync(join(tempDir, stale), bytes)
    fs.writeFileSync(
      join(tempDir, stale + '.json'),
      JSON.stringify(library.readImageRecipe(a.images[1].name)),
    )
    fs.writeFileSync(join(tempDir, unlocked), bytes)
    const originalRm = fs.rmSync
    const originalReadDir = fs.readdirSync
    try {
      fs.rmSync = (path, ...args) => {
        if (path === join(tempDir, stale)) {
          throw Object.assign(new Error('fixture occupied'), { code: 'EBUSY' })
        }
        return originalRm(path, ...args)
      }
      assert.ok(library.clearTemporaryImages(false).message)
      assert.ok(fs.existsSync(join(tempDir, stale + '.json')), 'locked image keeps its metadata')
      assert.ok(!fs.existsSync(join(tempDir, unlocked)), 'one failure does not block other files')
      assert.ok(client.imagePath(a.images[1].name), 'retry preserves this session')
      fs.readdirSync = (path, ...args) => {
        if (path === tempDir) {
          throw Object.assign(new Error('fixture denied'), { code: 'EACCES' })
        }
        return originalReadDir(path, ...args)
      }
      assert.ok(
        library.clearTemporaryImages(false).message,
        'directory error is reported without throwing',
      )
    } finally {
      fs.rmSync = originalRm
      fs.readdirSync = originalReadDir
    }
    assert.equal(library.clearTemporaryImages(false).message, '')
    assert.ok(!fs.existsSync(join(tempDir, stale)))
    assert.ok(client.imagePath(a.images[1].name))
    const favorite = recipes.createRecipe(a.images[1].name)
    recipes.updateRecipe(favorite.id, { name: '猫配方', note: '测试备注', tags: ['猫'] })
    const imported = await pages.createPage(a.images[1].name, params, 'v5', req)
    const owned = pageCurrent(imported).image
    assert.notEqual(owned.name, a.images[1].name)
    assert.equal(owned.storage, 'workspace')
    assert.ok(owned.contentHash)
    fs.writeFileSync(join(client.imageDir(), 'legacy.png'), bytes)
    const legacy = await pages.createPage('legacy.png', params, 'v5', req)
    pageCurrent(legacy).image = {
      ...pageCurrent(legacy).image,
      name: 'legacy.png',
      url: 'np-img://img/legacy.png',
    }
    pages.savePage(legacy)
    const legacyDoc = join(profile, 'data', 'page-workspaces', legacy.id + '.json')
    const legacyBefore = fs.readFileSync(legacyDoc, 'utf8')
    assert.equal(library.imageInfo('legacy.png').storage, 'workspace')
    assert.equal(client.listImages().find((i) => i.name === 'legacy.png').storage, 'workspace')
    assert.equal(
      fs.readFileSync(legacyDoc, 'utf8'),
      legacyBefore,
      'classification leaves legacy document unchanged',
    )
    pages.deletePage(legacy.id, legacy.revision)
    assert.equal(library.imageInfo('legacy.png').storage, 'workspace')
    assert.ok(pages.pageUsesImage('legacy.png'))
    library.clearTemporaryImages()
    assert.equal(client.imagePath(a.images[1].name), null)
    assert.ok(client.imagePath(owned.name))
    assert.ok(client.imagePath(retained.name))
    assert.ok(client.imagePath(b.images[0].name))
    assert.ok(client.imagePath('legacy.png'))
    assert.equal(recipes.listRecipes()[0].recipe.request.params.seed, 1)
    assert.ok(recipes.listRecipes()[0].thumbnail.startsWith('data:image/'))
    let w = await pages.createPage(null, params, 'v5', req)
    const generate = async () =>
      (w = await renderPage(
        w.id,
        w.revision,
        w.execution,
        () => {},
        () => false,
      ))
    const edit = (action) => (w = pages.editPage(w.id, w.revision, action))
    await generate()
    const first = w.currentVersionId
    const firstSnapshot = structuredClone(pageCurrent(w).generated)
    await generate()
    const second = w.latestGeneratedVersionId
    assert.equal(w.currentVersionId, first)
    assert.equal(w.versions.at(-1).groupId, pageCurrent(w).groupId)
    assert.equal(w.versions.at(-1).candidateNumber, 2)
    edit({
      type: 'editor',
      versionId: first,
      editor: { ...pageCurrent(w).editor, params: { ...params, seed: 123 } },
    })
    await generate()
    assert.equal(w.versions.at(-1).candidateNumber, 3)
    edit({
      type: 'editor',
      versionId: first,
      editor: { ...pageCurrent(w).editor, draft: { ...req, base: 'dog' } },
    })
    await generate()
    const changed = w.versions.at(-1)
    assert.notEqual(changed.groupId, w.versions.find((v) => v.id === second).groupId)
    assert.deepEqual(pageIteration(w, changed.id).before, firstSnapshot)
    edit({ type: 'switch', versionId: second })
    assert.equal(w.currentVersionId, second)
    await generate()
    assert.notEqual(
      w.versions.at(-1).groupId,
      pageCurrent(w).groupId,
      'A-B-A is a new scheme group',
    )
    const missing = pageCurrent(w).image
    const missingPath = client.imagePath(missing.name)
    fs.unlinkSync(missingPath)
    w = pages.readPage(w.id)
    fs.unlinkSync(missingPath + '.json')
    const recoveredRecipe = recipes.createWorkspaceRecipe(w.id, second)
    assert.deepEqual(
      recoveredRecipe.recipe.request.params,
      w.versions.find((v) => v.id === second).generated.params,
    )
    assert.equal(recoveredRecipe.thumbnail, '')
    recipes.deleteRecipe(recoveredRecipe.id)
    assert.ok(pageCurrent(w).image.missing)
    assert.ok(pageIteration(w, changed.id).result)
    assert.throws(() => pages.validateExecution(w, { kind: 'inpaint', regionId: 'none' }), /底图/)
    w = await discussPage(w.id, w.revision, '讨论提示词', null, [])
    assert.equal(aiInput.hasImage, false)
    assert.equal(aiInput.imageMissing, true)
    const wrong = join(profile, 'wrong.png')
    fs.writeFileSync(wrong, Buffer.from('wrong'))
    assert.throws(() => pages.recoverPageImage(w.id, w.revision, second, wrong), /不同/)
    const backup = join(profile, 'original.png')
    fs.writeFileSync(backup, bytes)
    w = pages.recoverPageImage(w.id, w.revision, second, backup)
    assert.ok(!pageCurrent(w).image.missing)
    pages.deletePage(w.id, w.revision)
    const removed = pages.listRemovedPages().find((r) => r.token.startsWith(w.id))
    assert.ok(removed)
    assert.ok(pages.pageUsesImage(missing.name))
    assert.ok(client.imagePath(missing.name))
    assert.equal(pages.restorePage(removed.token).currentVersionId, second)
    let paint = pages.readPage(imported.id)
    const paintSource = paint.currentVersionId
    const mask = new PNG({ width: 64, height: 64 })
    mask.data.fill(255)
    const region = {
      id: 'mask',
      label: 'AB',
      instruction: 'test',
      target: null,
      anchor: null,
      annotated: false,
      mask: PNG.sync.write(mask).toString('base64'),
      accepted: null,
    }
    paint = pages.editPage(paint.id, paint.revision, {
      type: 'editor',
      versionId: paintSource,
      editor: { ...pageCurrent(paint).editor, regions: [region] },
    })
    const roll = async () =>
      (paint = await renderPage(
        paint.id,
        paint.revision,
        { kind: 'inpaint', regionId: 'mask' },
        () => {},
        () => false,
      ))
    await roll()
    const paintGroup = paint.versions.at(-1).groupId
    assert.equal(
      paint.versions.at(-1).generated.params.noiseSchedule,
      'karras',
      'snapshot reflects actual request',
    )
    await roll()
    assert.equal(paint.versions.at(-1).groupId, paintGroup)
    assert.equal(paint.currentVersionId, paintSource)
    paint = pages.editPage(paint.id, paint.revision, {
      type: 'editor',
      versionId: paintSource,
      editor: { ...pageCurrent(paint).editor, strength: 0.5 },
    })
    await roll()
    assert.notEqual(
      paint.versions.at(-1).groupId,
      paintGroup,
      'strength changes create a new scheme',
    )
    const infillRecipe = recipes.createRecipe(paint.versions.at(-1).image.name)
    assert.equal(infillRecipe.recipe.sourceKind, 'inpaint')
    recipes.deleteRecipe(infillRecipe.id)
    fs.unlinkSync(client.imagePath(pageCurrent(paint).image.name))
    paint = pages.readPage(paint.id)
    paint = pages.editPage(paint.id, paint.revision, {
      type: 'editor',
      versionId: paintSource,
      editor: {
        ...pageCurrent(paint).editor,
        draft: { ...req, base: 'new prompt with missing source' },
      },
    })
    assert.equal(
      pageCurrent(paint).editor.draft.base,
      'new prompt with missing source',
      'missing image does not block text-only edits',
    )
    recipes.deleteRecipe(favorite.id)
    assert.equal(recipes.listRecipes().length, 0)
    console.log(
      'PASS retention snapshots, manual retain, restart cleanup, owned workspace copies, independent recipes, reroll grouping, explicit adoption, immutable comparisons, missing images, hash recovery and session restore; mocked calls:',
      calls,
    )
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
