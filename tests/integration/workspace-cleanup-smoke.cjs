const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Real file persistence in a temporary profile; recycle-bin calls are redirected here.
const { app, shell } = require('electron')
const fs = require('node:fs')
const { join, basename, resolve, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-workspace-cleanup-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const pages = require('../../src/main/modules/workspace/index.ts')
const cleanup = require('../../src/main/modules/workspace/image-cleanup.ts')
const library = require('../../src/main/modules/images/library.ts')
const { pageCurrent } = require('../../src/shared/workspace/model.ts')
const params = {
  width: 64,
  height: 64,
  steps: 1,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 1,
  count: 1,
  qualityTags: false,
  ucPreset: 'none',
}
const draft = { base: 'cat', negative: 'blurry', characters: [] }
const recipe = { schema: 1, request: { ...draft, version: 'v5', params }, sourceKind: 'generate' }
const png = new PNG({ width: 64, height: 64 })
png.data.fill(255)
const bytes = PNG.sync.write(png)
const recycle = join(profile, 'recycle')
fs.mkdirSync(recycle)
let failPath = ''
let block = null
shell.trashItem = async (path) => {
  assert.ok(
    resolve(path).startsWith(resolve(profile) + sep),
    'only isolated fixture files can be moved',
  )
  if (block) {
    await block
  }
  if (path === failPath) {
    throw Error('fixture occupied file')
  }
  fs.renameSync(path, join(recycle, randomUUID() + '-' + basename(path)))
}
async function project() {
  const w = await pages.createPage(null, params, 'v5', draft)
  const v = pageCurrent(w)
  v.image = library.storeGeneratedImage(bytes, recipe, 'workspace', w.id)
  v.generated = {
    model: 'v5',
    draft,
    params,
    execution: { kind: 'generate', regionId: null },
    sourceVersionId: v.id,
  }
  return pages.savePage(w)
}
app.whenReady().then(async () => {
  try {
    let w = await project()
    let v = pageCurrent(w)
    let name = v.image.name
    let path = library.libraryImagePath(name)
    const snapshot = structuredClone(v.generated)
    const favorite = require('../../src/main/modules/images/recipes.ts').createWorkspaceRecipe(
      w.id,
      v.id,
    )
    v.editor.regions = [
      {
        id: 'mask',
        label: 'AB',
        instruction: 'test',
        target: null,
        anchor: null,
        annotated: true,
        mask: bytes.toString('base64'),
        accepted: null,
      },
    ]
    w.execution = { kind: 'inpaint', regionId: 'mask' }
    pages.savePage(w)
    await assert.rejects(cleanup.clearPageImage(w.id, w.revision - 1, v.id), /更新/)
    failPath = path
    await assert.rejects(cleanup.clearPageImage(w.id, w.revision, v.id), /清理失败/)
    assert.ok(library.libraryImagePath(name))
    assert.equal(pageCurrent(pages.readPage(w.id)).image.name, name)
    failPath = ''
    let release
    block = new Promise((r) => (release = r))
    const clearing = cleanup.clearPageImage(w.id, w.revision, v.id)
    assert.throws(
      () =>
        pages.editPage(w.id, w.revision, {
          type: 'notes',
          title: 'blocked',
          goal: '',
          preserve: '',
          composer: '',
        }),
      /等待/,
    )
    await assert.rejects(cleanup.deletePageWithImages(w.id, w.revision), /等待/)
    release()
    block = null
    w = await clearing
    v = pageCurrent(w)
    assert.equal(v.image, null)
    assert.equal(v.imageCleared, true)
    assert.deepEqual(v.generated, snapshot)
    assert.deepEqual(v.editor.regions, [])
    assert.equal(w.execution.kind, 'generate')
    assert.equal(w.revision > 1, true)
    assert.equal(library.libraryImagePath(name), null)
    assert.ok(!fs.existsSync(path + '.json'))
    assert.ok(
      require('../../src/main/modules/images/recipes.ts')
        .listRecipes()
        .some((r) => r.id === favorite.id),
      'independent favorites survive image cleanup',
    )
    assert.ok(!library.listLibraryImages().some((i) => i.name === name))

    const owner = await project()
    const shared = await pages.createPage(null, params, 'v5', draft)
    const sharedName = pageCurrent(owner).image.name
    pageCurrent(shared).image = { ...pageCurrent(owner).image }
    pages.savePage(shared)
    await cleanup.clearPageImage(owner.id, owner.revision, owner.currentVersionId)
    assert.ok(library.libraryImagePath(sharedName), 'another active project keeps shared bytes')
    assert.ok(!pageCurrent(pages.readPage(shared.id)).image.missing)
    await cleanup.deletePageWithImages(owner.id, pages.readPage(owner.id).revision)
    assert.ok(
      library.libraryImagePath(sharedName),
      'owned directory cleanup also respects shared references',
    )
    await cleanup.deletePageWithImages(shared.id, shared.revision)
    assert.equal(library.libraryImagePath(sharedName), null)

    const full = await project()
    const fullName = pageCurrent(full).image.name
    const fullPath = library.libraryImagePath(fullName)
    const extra = library.storeGeneratedImage(bytes, recipe, 'workspace', full.id)
    failPath = fullPath + '.json'
    await assert.rejects(cleanup.deletePageWithImages(full.id, full.revision), /清理失败/)
    assert.ok(
      pages.listPages().some((p) => p.id === full.id),
      'partial failure leaves project available for retry',
    )
    assert.ok(fs.existsSync(fullPath + '.json'))
    failPath = ''
    await cleanup.deletePageWithImages(full.id, full.revision)
    assert.ok(!fs.existsSync(fullPath + '.json'))
    assert.equal(library.libraryImagePath(extra.name), null)
    assert.ok(!pages.listPages().some((p) => p.id === full.id))
    const removed = pages.listRemovedPages().find((p) => p.token.startsWith(full.id))
    assert.ok(removed)
    assert.ok(
      pageCurrent(pages.restorePage(removed.token)).image.missing,
      'restored records do not claim cleaned files still exist',
    )

    const old = await project()
    const oldName = pageCurrent(old).image.name
    pages.deletePage(old.id, old.revision)
    const orphan = library.storeGeneratedImage(bytes, recipe, 'workspace', randomUUID())
    const active = await project()
    const activeName = pageCurrent(active).image.name
    const activeOrphan = library.storeGeneratedImage(bytes, recipe, 'workspace', active.id)
    const root = join(profile, 'data', 'page-workspaces')
    const corrupt = join(root, randomUUID() + '.json')
    fs.writeFileSync(corrupt, 'broken')
    await assert.rejects(cleanup.cleanRemovedPageImages(), /无法读取/)
    assert.ok(library.libraryImagePath(oldName))
    fs.unlinkSync(corrupt)
    let releaseCleanup
    block = new Promise((r) => (releaseCleanup = r))
    const oldToken = pages.listRemovedPages().find((p) => p.token.startsWith(old.id)).token
    const oldCleanup = cleanup.cleanRemovedPageImages()
    assert.throws(
      () => pages.restorePage(oldToken),
      /正在清理/,
      'restoring cannot race image cleanup',
    )
    releaseCleanup()
    block = null
    assert.ok((await oldCleanup) >= 2)
    assert.equal(library.libraryImagePath(oldName), null)
    assert.equal(library.libraryImagePath(orphan.name), null)
    assert.ok(library.libraryImagePath(activeName))
    assert.ok(
      library.libraryImagePath(activeOrphan.name),
      'active project files including uncommitted results remain',
    )
    assert.equal(await cleanup.cleanRemovedPageImages(), 0, 'cleanup can be safely repeated')
    console.log(
      'PASS individual cleanup, snapshots/favorites, stale revision, locks, shared images, project deletion, partial failure/retry, orphan/legacy cleanup and corrupt-record protection',
    )
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
