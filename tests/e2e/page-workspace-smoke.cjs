const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Offline service + Electron UI regression. All model traffic is intercepted.
// Profiles and screenshots are kept outside the repository.
const { app, BrowserWindow, ipcMain, net, protocol, shell } = require('electron')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(__dirname, '../../out'))
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-page-workspace-')
const artifacts = artifactDirectory(profile)
mkdirSync(artifacts, { recursive: true })
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
protocol.registerSchemesAsPrivileged([
  { scheme: 'np-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
require('../support/register-typescript.cjs')
const client = require('../../src/main/modules/generation/index.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
const cleanup = require('../../src/main/modules/workspace/image-cleanup.ts')
const recycle = join(profile, 'recycle')
mkdirSync(recycle)
shell.trashItem = async (path) => {
  assert.ok(
    require('node:path')
      .resolve(path)
      .startsWith(require('node:path').resolve(profile) + require('node:path').sep),
  )
  require('node:fs').renameSync(
    path,
    join(recycle, require('node:crypto').randomUUID() + '-' + require('node:path').basename(path)),
  )
}
const collaborator = require('../../src/main/modules/workspace/collaboration.ts')
const {
  pageCurrent,
  pageDraft,
  pageIteration,
  pageConfigurationChanges,
} = require('../../src/shared/workspace/model.ts')
const { renderMarkdown } = require('../../src/renderer/src/shared/lib/markdown.ts')
const { isWebUrl } = require('../../src/shared/web-url.ts')
const { extractJson } = require('../../src/main/providers/chat/client.ts')
const markdownSample =
  '## 修改建议\n\n**保留主体轮廓**，调整 `grey shirt`。\n\n1. 先检查提示词\n2. 再生成图片\n\n> 采纳后仍需单独执行\n\n```text\nblack shirt\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 提示词 | 更新 |\n\n[参考说明](https://example.com/guide)'
const markdownAttack =
  '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>\n\n[危险](javascript:alert(1))\n\n![远程图片](https://example.com/tracker.png)\n\n[本地文件](file:///C:/private.txt)'
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
const skills = require('../../src/main/modules/skills/service.ts')
const width = 640
const height = 896
function image(color, w = width, h = height) {
  const p = new PNG({ width: w, height: h })
  for (let i = 0; i < p.data.length; i += 4) {
    p.data.set(color, i)
  }
  return p
}
function rect(p, x, y, w, h, color) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      p.data.set(color, (j * width + i) * 4)
    }
  }
}
const source = image([255, 255, 255, 255])
for (const [x, y, w, h] of [
  [24, 24, 592, 220],
  [24, 264, 280, 600],
  [324, 264, 292, 600],
]) {
  rect(source, x, y, w, h, [32, 32, 32, 255])
  rect(source, x + 4, y + 4, w - 8, h - 8, [243, 243, 243, 255])
}
rect(source, 70, 340, 180, 240, [130, 130, 130, 255])
rect(source, 100, 590, 120, 240, [70, 70, 70, 255])
writeFileSync(join(client.imageDir(), 'page-fixture.png'), PNG.sync.write(source))
const mask = image([0, 0, 0, 255])
rect(mask, 90, 350, 100, 150, [255, 255, 255, 255])
const region = {
  id: 'region-stable',
  label: 'AB',
  instruction: '灰色衣服改成黑色，保留轮廓',
  target: null,
  anchor: { x: 0.2, y: 0.4 },
  annotated: true,
  mask: PNG.sync.write(mask).toString('base64'),
  accepted: null,
}
const draft = {
  base: 'monochrome, comic, grey shirt, standing',
  negative: 'blurry',
  characters: [],
}
const params = {
  width,
  height,
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'native',
  seed: 42,
  count: 1,
  qualityTags: false,
  ucPreset: 'none',
}
saveSettings({
  apiKey: 'fixture',
  baseUrl: 'https://fixture.test/v1',
  model: 'fixture-vision',
  naiToken: 'fixture',
  naiVersion: 'v5',
  naiFreeOnly: true,
})
const nativeFetch = net.fetch
let aiInputs = []
let generationInputs = []
let mode = 'change'
let delay = 0
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
    const body = JSON.parse(init.body)
    const parts = body.messages[1].content
    assert.ok(Array.isArray(parts))
    const input = JSON.parse(parts[0].text)
    aiInputs.push({ input, parts, system: body.messages[0].content, messages: body.messages })
    if (delay) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delay)
        init.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            reject(new Error('fixture cancelled'))
          },
          { once: true },
        )
      })
    }
    if (mode === 'malformed') {
      return Response.json({ choices: [{ message: { content: 'not json' } }] })
    }
    if (mode === 'tool' && !body.messages.some((m) => m.role === 'tool')) {
      return Response.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'fixture-tool',
                  type: 'function',
                  function: {
                    name: 'validate_tags',
                    arguments: JSON.stringify({ tags: ['grey shirt'] }),
                  },
                },
              ],
            },
          },
        ],
      })
    }
    const resolveProposed = () => {
      if (input.draft.base) {
        return (
          input.draft.base.replace('grey shirt', 'black shirt') +
          (input.draft.base.includes('black shirt') ? ', subtle shading' : '')
        )
      }
      return 'A simple grey object stands on a table.'
    }
    const proposed = {
      ...input.draft,
      base: resolveProposed(),
    }
    const resolveReply = () => {
      if (mode === 'discuss') {
        return null
      }
      return {
        title: '调整主体明暗',
        warning: '请先检查当前提示词与执行方式。',
        draft: proposed,
        execution: {
          kind: mode === 'inpaint' ? 'inpaint' : 'generate',
          regionId: mode === 'inpaint' ? input.currentRegion?.id : null,
          regionIds: mode === 'inpaint' ? input.selectedRegions.map((region) => region.id) : [],
        },
      }
    }
    const reply = {
      reply: markdownSample,
      understanding: { goal: '调整主体明暗', preserve: '保留主体轮廓' },
      proposal: resolveReply(),
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] })
  }
  assert.equal(
    url,
    'https://image.novelai.net/ai/generate-image',
    'No unexpected external requests',
  )
  generationInputs.push(JSON.parse(init.body))
  return new Response(
    PNG.sync.write(
      image(
        [28, 28, 28, 255],
        generationInputs.at(-1).parameters.width,
        generationInputs.at(-1).parameters.height,
      ),
    ),
    { headers: { 'content-type': 'image/png' } },
  )
}
const openedLinks = []
const handlers = {
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'web:open': (_, url) => {
    assert.ok(isWebUrl(url))
    openedLinks.push(url)
  },
  'images:cleanup-status': () => ({ pending: 1, message: '测试：上次临时文件清理失败' }),
  'images:cleanup-retry': () => ({ pending: 0, message: '' }),
  'settings:get': () => getSettings(),
  'settings:save': (_, v) => saveSettings(v),
  'window:image-preview': () => {},
  'db:status': () => ({
    loaded: true,
    tagCount: 0,
    aliasCount: 0,
    zhCount: 0,
    implicationCount: 0,
  }),
  'skills:list': () => skills.getConfig(),
  'mcp:info': () => null,
  'update:check': () => null,
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
  'update:state': () => null,
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'nai:subscription': () => client.getSubscription(),
  'nai:freeCheck': (_, ...args) => client.freeCheck(...args),
  'nai:generate': (_, req) =>
    client.generateImages(
      req,
      () => {},
      () => false,
    ),
  'nai:retain': (_, name) => require('../../src/main/modules/images/library.ts').retainImage(name),
  'nai:recipe': (_, name) =>
    require('../../src/main/modules/images/library.ts').readImageRecipe(name),
  'nai:list': () => client.listImages(),
  'nai:readImage': (_, name) => new Uint8Array(readFileSync(client.imagePath(name))),
  'pages:delete': async (e, id, rev) => {
    try {
      await cleanup.deletePageWithImages(id, rev)
    } finally {
      e.sender.send('gallery:changed')
    }
  },
  'pages:clear-image': async (e, id, rev, version) => {
    try {
      return await cleanup.clearPageImage(id, rev, version)
    } finally {
      e.sender.send('gallery:changed')
    }
  },
  'pages:cleanup-removed-images': async (e) => {
    try {
      return await cleanup.cleanRemovedPageImages()
    } finally {
      e.sender.send('gallery:changed')
    }
  },
  'pages:removed': () => pages.listRemovedPages(),
  'pages:restore': (_, token) => pages.restorePage(token),
  'recipes:workspace': (_, id, versionId) =>
    require('../../src/main/modules/images/recipes.ts').createWorkspaceRecipe(id, versionId),
  'recipes:config': (_, request) =>
    require('../../src/main/modules/images/recipes.ts').createConfigRecipe(request),
  'recipes:list': () => require('../../src/main/modules/images/recipes.ts').listRecipes(),
  'recipes:create': (_, name) =>
    require('../../src/main/modules/images/recipes.ts').createRecipe(name),
  'recipes:update': (_, id, patch) =>
    require('../../src/main/modules/images/recipes.ts').updateRecipe(id, patch),
  'pages:list': () => pages.listPages(),
  'pages:read': (_, id) => pages.readPage(id),
  'pages:create': (_, ...args) => pages.createPage(...args),
  'pages:edit': (_, ...args) => pages.editPage(...args),
  'pages:chat': (_, id, revision, text, region, refs, _actionId, discussionVersionId) =>
    collaborator.discussPage(id, revision, text, region, refs, discussionVersionId),
  'pages:cancel': (_, id) => pages.pageLocks.get(id)?.abort(),
  'pages:generate': (e, id, rev, r) =>
    collaborator.renderPage(
      id,
      rev,
      r,
      (s) => e.sender.send('nai:step', { id: 'fixture', kind: 'page-generate', step: s }),
      () => false,
    ),
}
for (const [name, handler] of Object.entries(handlers)) {
  ipcMain.handle(name, handler)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
app.whenReady().then(async () => {
  let win
  try {
    const { reviewPrompt } = require('../../src/main/modules/prompts/previewer.ts')
    require('../../src/main/modules/tags/store.ts').tagStore.load()
    const textRequest = {
      base: '',
      negative: '',
      characters: [
        { prompt: 'other', negative: 'text' },
        { prompt: 'boy, Text: Hello', negative: '' },
      ],
      version: 'v5',
      params,
      expectation: '',
    }
    assert.doesNotMatch(await reviewPrompt(textRequest), /角色 1 负面里的 text 会压制/)
    assert.match(
      await reviewPrompt({
        ...textRequest,
        characters: [{ prompt: 'other, Text: Hello', negative: 'text' }],
      }),
      /角色 1 负面里的 text 会压制/,
    )
    const md = renderMarkdown(markdownSample)
    const payload = { reply: markdownSample, proposal: null }
    assert.deepEqual(extractJson(JSON.stringify(payload)), payload)
    assert.deepEqual(extractJson('```json\n' + JSON.stringify(payload) + '\n```'), payload)
    assert.deepEqual(
      extractJson('说明\n```json\n' + JSON.stringify(payload) + '\n```\n结束'),
      payload,
    )
    assert.throws(() => extractJson('not json'))
    for (const tag of ['h2', 'strong', 'code', 'ol', 'blockquote', 'pre', 'table']) {
      assert.ok(md.includes('<' + tag), tag + ' renders')
    }
    assert.doesNotMatch(
      renderMarkdown(markdownAttack),
      /<(?:script|img)\b|href="(?:javascript:|file:)/i,
    )
    assert.ok(
      !isWebUrl('file:///C:/private.txt') &&
        !isWebUrl('javascript:alert(1)') &&
        !isWebUrl('https://user:pass@example.com'),
    )
    const originalConfig = skills.getConfig().map((s) => ({ id: s.id, enabled: s.enabled }))
    const custom = skills.createSkill({
      name: '会话规则测试',
      scope: 'optimize',
      model: 'v5',
      content: 'WORKSPACE_ENABLED_ONLY_MARKER',
    })
    skills.setConfig(skills.getConfig().map((s) => ({ id: s.id, enabled: s.id === custom.id })))
    assert.match(skills.composeSkills('workspace', 'v5').text, /WORKSPACE_ENABLED_ONLY_MARKER/)
    assert.doesNotMatch(
      skills.composeSkills('workspace', 'v4.5').text,
      /WORKSPACE_ENABLED_ONLY_MARKER/,
    )
    skills.setConfig(
      skills.getConfig().map((s) => ({ id: s.id, enabled: s.id === 'builtin:preview' })),
    )
    const previewSkills = skills.composeSkills('preview', 'v5')
    assert.equal(previewSkills.skills.length, 1)
    assert.doesNotMatch(previewSkills.text, /参考知识（摘自《内置 · 提示词编排》/)
    assert.ok(!previewSkills.text.includes('<skill priority="2"'))
    assert.ok(!previewSkills.text.includes(skills.getSkill('builtin:prompt').content.trim()))
    skills.setConfig(skills.getConfig().map((s) => ({ id: s.id, enabled: s.id === custom.id })))
    let w = await pages.createPage(null, params, 'v5', { base: '', negative: '', characters: [] })
    const id = w.id
    const original = w.currentVersionId
    const edit = (a) => (w = pages.editPage(id, w.revision, a))
    const talk = async (text, r = null, refs = [], discussionVersionId) =>
      (w = await collaborator.discussPage(id, w.revision, text, r, refs, discussionVersionId))
    const proposal = () => w.messages.findLast((m) => m.proposal)
    const decide = (decision) => edit({ type: 'proposal', messageId: proposal().id, decision })
    assert.equal(pageCurrent(w).image, null)
    assert.equal(generationInputs.length, 0)
    await talk('我要一个灰色物体，保留主体轮廓')
    assert.equal(aiInputs.at(-1).parts.filter((p) => p.type === 'image_url').length, 0)
    assert.equal(w.goal, '调整主体明暗')
    assert.equal(w.preserve, '保留主体轮廓')
    assert.match(aiInputs.at(-1).system, /WORKSPACE_ENABLED_ONLY_MARKER/)
    assert.equal(
      w.messages.findLast((m) => m.role === 'user').skillSnapshot.text,
      skills.composeSkills('workspace', 'v5').text,
    )
    assert.equal(w.messages.at(-1).discussion.versionId, original)
    assert.equal(w.messages.at(-1).discussion.recipe.source, 'initial')
    assert.doesNotMatch(aiInputs.at(-1).system, /漫画成品页|先列单元表/)
    assert.equal(pageCurrent(w).editor.draft.base, '')
    decide('accept')
    assert.match(pageCurrent(w).editor.draft.base, /grey object/)
    decide('undo')
    assert.equal(pageCurrent(w).editor.draft.base, '')
    const replacedId = proposal().id
    await talk('按刚才的目标继续')
    assert.equal(w.messages.filter((m) => m.versionId === original && m.proposal).length, 2)
    assert.ok(w.messages.find((m) => m.id === replacedId).proposal.superseded)
    assert.ok(w.messages.find((m) => m.id === replacedId).proposal.before)
    assert.throws(
      () => edit({ type: 'proposal', messageId: replacedId, decision: 'accept' }),
      /已有更新|已变化/,
    )
    decide('accept')
    w = await collaborator.renderPage(
      id,
      w.revision,
      w.execution,
      () => {},
      () => false,
    )
    assert.equal(generationInputs.at(-1).action, 'generate')
    assert.ok(!generationInputs.at(-1).parameters.image)
    assert.equal(pageCurrent(w).parentId, original)
    assert.deepEqual(pageCurrent(w).generated.draft, pageCurrent(w).editor.draft)
    const generated = w.currentVersionId
    assert.equal(
      pageIteration(w, generated).before.draft.base,
      '',
      'first iteration compares immutable session start',
    )
    assert.ok(pageIteration(w, generated).changes.length)
    const firstSnapshot = structuredClone(pageCurrent(w).generated)
    edit({
      type: 'editor',
      versionId: generated,
      editor: { ...pageCurrent(w).editor, draft, regions: [region] },
    })
    assert.equal(w.execution.kind, 'generate', 'annotations never choose execution mode')
    mode = 'change'
    await talk('我圈出的是这个部位，请调整提示词', region.id)
    assert.equal(aiInputs.at(-1).parts.filter((p) => p.type === 'image_url').length, 2)
    assert.equal(proposal().proposal.execution.kind, 'generate')
    edit({ type: 'execution', execution: { kind: 'inpaint', regionId: region.id } })
    assert.throws(() => decide('accept'), /变化/)
    decide('reject')
    mode = 'inpaint'
    await talk('这次只重绘这个遮罩内的部位', region.id)
    decide('accept')
    const before = PNG.sync.read(readFileSync(client.imagePath(pageCurrent(w).image.name)))
    w = await collaborator.renderPage(
      id,
      w.revision,
      w.execution,
      () => {},
      () => false,
    )
    assert.equal(w.currentVersionId, generated, 'reroll does not implicitly adopt')
    edit({ type: 'switch', versionId: w.latestGeneratedVersionId })
    assert.equal(generationInputs.at(-1).action, 'infill')
    assert.match(generationInputs.at(-1).input, /black shirt/)
    const result = PNG.sync.read(readFileSync(client.imagePath(pageCurrent(w).image.name)))
    for (let i = 0; i < before.data.length; i += 4) {
      if (!mask.data[i]) {
        assert.ok(before.data.subarray(i, i + 4).equals(result.data.subarray(i, i + 4)))
      }
    }
    const snapshot = structuredClone(pageCurrent(w).generated)
    assert.deepEqual(
      pageIteration(w, w.currentVersionId).before,
      firstSnapshot,
      'compare actual source generation, not its modified editor',
    )
    assert.ok(pageIteration(w, w.currentVersionId).changes.length)
    assert.equal(snapshot.inpaint.instruction, region.instruction)
    assert.equal(snapshot.inpaint.label, region.label)
    assert.equal(snapshot.inpaint.mask, region.mask)
    assert.equal(snapshot.inpaint.strength, pageCurrent(w).editor.strength)
    const comparisonFixture = structuredClone(w)
    const comparisonSource = comparisonFixture.versions.find((v) => v.id === generated)
    comparisonSource.generated = structuredClone(snapshot)
    assert.deepEqual(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).parameters,
      [],
    )
    assert.deepEqual(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).changes,
      [],
    )
    assert.equal(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).maskChanged,
      false,
      'unchanged masks are not displayed',
    )
    comparisonSource.generated.params.seed = -1
    assert.deepEqual(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).parameters.map(
        (p) => p.label,
      ),
      ['种子'],
      'seed-only rerolls do not repeat unchanged parameters',
    )
    comparisonSource.generated.model = 'v4.5'
    comparisonSource.generated.params.qualityTags = true
    comparisonSource.generated.inpaint.mask = 'different-mask'
    assert.deepEqual(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).parameters.map(
        (p) => p.label,
      ),
      ['种子', 'Add Quality Tags', '模型'],
    )
    assert.equal(
      pageConfigurationChanges(comparisonFixture, w.currentVersionId, generated).maskChanged,
      true,
    )
    edit({
      type: 'editor',
      versionId: w.currentVersionId,
      editor: {
        ...pageCurrent(w).editor,
        draft: { ...pageCurrent(w).editor.draft, base: 'A different object.' },
      },
    })
    assert.deepEqual(
      pageCurrent(w).generated,
      snapshot,
      'generated prompt remains immutable after editing',
    )
    assert.deepEqual(pageIteration(w, w.currentVersionId).result, snapshot)
    const old = structuredClone(w)
    delete old.versions.find((v) => v.id === generated).generated
    assert.equal(
      pageIteration(old, old.currentVersionId).before,
      undefined,
      'missing historical snapshot must not fall back to edited draft',
    )
    assert.ok(w.messages.at(-1).draftBefore)
    const retainedProposalId = proposal().id
    mode = 'discuss'
    await talk('参考上一版，先讨论', region.id, [generated])
    assert.equal(aiInputs.at(-1).parts.filter((p) => p.type === 'image_url').length, 3)
    assert.equal(
      proposal().id,
      retainedProposalId,
      'discussion without a new proposal does not erase latest suggestion',
    )
    const editTarget = w.currentVersionId
    const discussionRecipe = structuredClone(w.versions.find((v) => v.id === generated).generated)
    await talk('这张图有哪些问题？', null, [], generated)
    assert.equal(aiInputs.at(-1).input.discussion.versionId, generated)
    assert.equal(aiInputs.at(-1).input.discussion.recipe.source, 'generated')
    assert.equal(aiInputs.at(-1).input.editTarget.versionId, editTarget)
    assert.deepEqual(
      aiInputs.at(-1).input.discussion.recipe.draft,
      discussionRecipe.draft,
      'image context uses the immutable generation recipe',
    )
    assert.equal(
      aiInputs.at(-1).parts.filter((p) => p.type === 'image_url').length,
      2,
      'both discussed and editable images are visible to the model',
    )
    assert.equal(w.currentVersionId, editTarget, 'discussion does not adopt another image')
    assert.equal(w.messages.at(-1).versionId, editTarget)
    assert.equal(w.messages.at(-1).discussion.versionId, generated)
    const messageCount = w.messages.length
    await assert.rejects(talk('不存在的讨论对象', null, [], 'missing-version'), /讨论版本/)
    assert.equal(
      pages.readPage(id).messages.length,
      messageCount,
      'invalid discussion is rejected before saving a message',
    )
    const { tagStore } = require('../../src/main/modules/tags/store.ts')
    tagStore.loaded = true
    mode = 'tool'
    await talk('先查证这个词，再给方案')
    assert.ok(
      aiInputs.at(-1).messages.some((m) => m.role === 'tool' && m.tool_call_id === 'fixture-tool'),
    )
    tagStore.loaded = false
    mode = 'malformed'
    await assert.rejects(talk('格式错误测试'))
    w = pages.readPage(id)
    assert.ok(!pages.pageLocks.has(id))
    mode = 'discuss'
    delay = 1000
    const count = aiInputs.length
    const cancelled = talk('取消测试')
    while (aiInputs.length === count) {
      await pause(10)
    }
    assert.throws(() => pages.deletePage(id, w.revision), /等待/)
    pages.pageLocks.get(id).abort()
    await assert.rejects(cancelled)
    delay = 0
    w = pages.readPage(id)
    assert.ok(!pages.pageLocks.has(id))
    assert.match(w.messages.at(-1).text, /取消/)
    edit({ type: 'switch', versionId: original })
    assert.equal(pageCurrent(w).image, null)
    w = await collaborator.renderPage(
      id,
      w.revision,
      w.execution,
      () => {},
      () => false,
    )
    assert.equal(pageCurrent(w).parentId, original)
    assert.equal(
      pageIteration(w, w.currentVersionId).source.id,
      original,
      'branches compare actual parent, not chronological predecessor',
    )
    assert.equal(pageIteration(w, w.currentVersionId).before.draft.base, '')
    const imported = await pages.importPage(
      join(client.imageDir(), 'page-fixture.png'),
      params,
      'v5',
      draft,
    )
    const importedName = pageCurrent(imported).image.name
    assert.notEqual(importedName, 'page-fixture.png')
    assert.throws(() => pages.deletePage(imported.id, imported.revision - 1), /更新/)
    pages.deletePage(imported.id, imported.revision)
    assert.ok(!pages.listPages().some((s) => s.id === imported.id))
    assert.ok(client.imagePath(importedName))
    const legacy = await pages.createPage('page-fixture.png', params, 'v5', draft)
    legacy.schema = 1
    delete legacy.execution
    pageCurrent(legacy).editor.regions = [
      { ...region, accepted: { ...draft, base: 'Legacy accepted draft.' } },
    ]
    pages.savePage(legacy)
    const migrated = pages.readPage(legacy.id)
    assert.equal(migrated.schema, 2)
    assert.equal(migrated.versions.length, 2)
    assert.equal(migrated.versions[1].editor.draft.base, 'Legacy accepted draft.')
    assert.deepEqual(
      pages.readPage(legacy.id),
      migrated,
      'migration occurs once and keeps IDs stable',
    )
    let batch = await pages.createPage('page-fixture.png', params, 'v5', draft)
    const batchSource = batch.currentVersionId
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'editor',
      versionId: batchSource,
      editor: {
        ...pageCurrent(batch).editor,
        params: { ...params, count: 4, qualityTags: true, ucPreset: 'light' },
      },
    })
    const batchStart = generationInputs.length
    batch = await collaborator.renderPage(
      batch.id,
      batch.revision,
      batch.execution,
      () => {},
      () => false,
    )
    const generatedBatch = batch.versions.filter((v) => v.generated)
    assert.equal(generatedBatch.length, 4)
    assert.equal(batch.currentVersionId, batchSource)
    assert.equal(new Set(generatedBatch.map((v) => v.groupId)).size, 1)
    assert.deepEqual(
      generatedBatch.map((v) => v.candidateNumber),
      [1, 2, 3, 4],
    )
    assert.deepEqual(
      generatedBatch.map((v) => v.generated.params.seed),
      [42, 43, 44, 45],
    )
    for (const [i, v] of generatedBatch.entries()) {
      assert.equal(v.generated.draft.base, generationInputs[batchStart + i].input)
      assert.notEqual(
        v.generated.draft.base,
        draft.base,
        'quality tags reach generation and snapshot',
      )
      assert.notEqual(
        v.generated.draft.negative,
        draft.negative,
        'UC preset reaches generation and snapshot',
      )
      assert.equal(v.editor.params.count, 4)
      assert.equal(v.editor.params.qualityTags, true)
    }
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'editor',
      versionId: batchSource,
      editor: { ...pageCurrent(batch).editor, regions: [region], params: { ...params, count: 2 } },
    })
    batch = await collaborator.renderPage(
      batch.id,
      batch.revision,
      { kind: 'inpaint', regionId: region.id },
      () => {},
      () => false,
    )
    for (const v of batch.versions.slice(-2)) {
      const pixels = PNG.sync.read(readFileSync(client.imagePath(v.image.name)))
      for (let i = 0; i < source.data.length; i += 4) {
        if (!mask.data[i]) {
          assert.ok(
            source.data.subarray(i, i + 4).equals(pixels.data.subarray(i, i + 4)),
            'every inpaint result preserves outside-mask pixels',
          )
        }
      }
    }
    // Joint discussion, immutable selection, proposal scope, union masks and undo.
    const secondMask = image([0, 0, 0, 255])
    rect(secondMask, 390, 590, 60, 80, [255, 255, 255, 255])
    const secondRegion = {
      ...region,
      id: 'second',
      label: 'CD',
      instruction: '调整右下区域',
      mask: PNG.sync.write(secondMask).toString('base64'),
    }
    const unselectedMask = image([0, 0, 0, 255])
    rect(unselectedMask, 220, 60, 40, 40, [255, 255, 255, 255])
    const unselectedRegion = {
      ...region,
      id: 'unselected',
      label: 'EF',
      instruction: '这轮不要修改',
      mask: PNG.sync.write(unselectedMask).toString('base64'),
    }
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'editor',
      versionId: batchSource,
      editor: {
        ...pageCurrent(batch).editor,
        regions: [region, secondRegion, unselectedRegion],
        params: { ...params, count: 1 },
      },
    })
    const selectedIds = [region.id, secondRegion.id]
    const { validateExecution } = require('../../src/main/modules/workspace/validation.ts')
    const { mergeRegionMasks } = require('../../src/main/modules/workspace/region-mask.ts')
    const { selectRegions, regionIds } = require('../../src/shared/workspace/regions.ts')
    assert.deepEqual(regionIds({ regionId: region.id }), [region.id])
    assert.throws(() => selectRegions(pageCurrent(batch), [region.id, region.id]), /不重复/)
    assert.throws(() => selectRegions(pageCurrent(batch), ['missing']), /不存在/)
    assert.throws(
      () =>
        validateExecution(
          batch,
          { kind: 'inpaint', regionId: region.id, regionIds: [region.id] },
          selectedIds,
        ),
      /全部区域/,
    )
    assert.throws(
      () =>
        validateExecution(
          batch,
          {
            kind: 'inpaint',
            regionId: region.id,
            regionIds: [...selectedIds, unselectedRegion.id],
          },
          selectedIds,
        ),
      /全部区域/,
    )
    const merged = PNG.sync.read(
      Buffer.from(
        mergeRegionMasks(PNG.sync.write(source), [region, secondRegion], width, height),
        'base64',
      ),
    )
    for (let i = 0; i < merged.data.length; i += 4) {
      assert.equal(merged.data[i], Math.max(mask.data[i], secondMask.data[i]))
      assert.equal(merged.data[i + 3], 255)
    }
    mode = 'inpaint'
    batch = await collaborator.discussPage(
      batch.id,
      batch.revision,
      '一起修改 AB 和 CD，保持其他位置',
      selectedIds,
      [],
    )
    assert.deepEqual(
      aiInputs.at(-1).input.selectedRegions.map((region) => region.id),
      selectedIds,
    )
    assert.ok(
      aiInputs.at(-1).input.selectedRegions.every((region) => region.bounds && region.instruction),
    )
    const jointMessage = batch.messages.findLast((message) => message.proposal)
    const requestMessage = batch.messages.findLast((message) => message.role === 'user')
    assert.deepEqual(requestMessage.regionIds, selectedIds)
    assert.equal(requestMessage.regions.length, 2)
    assert.deepEqual(jointMessage.proposal.execution.regionIds, selectedIds)
    const beforeJoint = structuredClone(pageCurrent(batch).editor.draft)
    const previousExecution = structuredClone(batch.execution)
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'proposal',
      messageId: jointMessage.id,
      decision: 'accept',
    })
    const unionGenerationStart = generationInputs.length
    batch = await collaborator.renderPage(
      batch.id,
      batch.revision,
      batch.execution,
      () => {},
      () => false,
    )
    assert.equal(
      generationInputs.length,
      unionGenerationStart + 1,
      'one request for the complete union',
    )
    const jointVersion = batch.versions.at(-1)
    const unionPixels = PNG.sync.read(readFileSync(client.imagePath(jointVersion.image.name)))
    const savedUnion = PNG.sync.read(Buffer.from(jointVersion.generated.inpaint.mask, 'base64'))
    assert.deepEqual(savedUnion.data, merged.data)
    assert.deepEqual(
      jointVersion.generated.inpaint.regions.map((region) => region.id),
      selectedIds,
    )
    for (let i = 0; i < source.data.length; i += 4) {
      if (!merged.data[i]) {
        assert.ok(
          source.data.subarray(i, i + 4).equals(unionPixels.data.subarray(i, i + 4)),
          'unselected regions and all outside pixels are preserved',
        )
      }
    }
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'proposal',
      messageId: jointMessage.id,
      decision: 'undo',
    })
    assert.deepEqual(pageCurrent(batch).editor.draft, beforeJoint)
    assert.deepEqual(batch.execution, previousExecution)
    const persisted = pages.readPage(batch.id)
    assert.deepEqual(
      persisted.messages.find((message) => message.id === requestMessage.id).regions,
      requestMessage.regions,
    )
    console.log(
      'PASS multi-region AI discussion, scope validation, exact mask union, single generation, unselected pixels, snapshots and undo',
    )
    batch = pages.editPage(batch.id, batch.revision, {
      type: 'editor',
      versionId: batchSource,
      editor: { ...pageCurrent(batch).editor, params: { ...params, count: 4 } },
    })
    const partialStart = generationInputs.length
    const versionsBefore = batch.versions.length
    batch = await collaborator.renderPage(
      batch.id,
      batch.revision,
      { kind: 'generate', regionId: null },
      () => {},
      () => generationInputs.length >= partialStart + 2,
    )
    assert.equal(
      batch.versions.length,
      versionsBefore + 2,
      'completed images are retained after batch cancellation',
    )
    assert.equal(batch.currentVersionId, batchSource)
    assert.match(batch.messages.at(-1).text, /停止|取消/)
    pages.deletePage(batch.id, batch.revision)
    console.log(
      'PASS editable quality/UC presets, batch snapshots and seeds, batch inpaint masks, partial cancellation',
    )
    skills.setConfig([...originalConfig, { id: custom.id, enabled: false }])
    console.log(
      'PASS blank sessions, enabled Skill isolation, conversation memory, prompt adoption/undo, explicit execution, tool use, generation snapshots, references, migration, deletion, cancellation and outside-mask pixels',
    )

    protocol.handle('np-img', (req) => {
      const file = client.imagePath(decodeURIComponent(new URL(req.url).pathname.slice(1)))
      return file
        ? nativeFetch(pathToFileURL(file).toString())
        : new Response('Image missing', { status: 404 })
    })
    win = new BrowserWindow({
      width: 1440,
      height: 960,
      show: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
      webPreferences: {
        preload: join(buildDirectory, 'preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
        offscreen: true,
      },
    })
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code, true)
      } catch (error) {
        throw new Error(code + ': ' + error.message)
      }
    }
    const run = async (code) => {
      const v = await js(code)
      await pause(100)
      return v
    }
    const wait = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) {
          return
        }
        await pause(50)
      }
      throw new Error('Timed out: ' + code)
    }
    const click = (selector, text) =>
      run(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})&&e.getClientRects().length&&!e.disabled);if(!e)throw new Error('Missing button '+${JSON.stringify(text)});e.click()})()`,
      )
    const input = (selector, value) =>
      run(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      )
    const shot = async (name) => {
      await pause(300)
      writeFileSync(join(artifacts, name), (await win.webContents.capturePage()).toPNG())
    }
    await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    await pause(600)
    assert.ok(await js(`document.body.textContent.includes('测试：上次临时文件清理失败')`))
    await click('.frontend-status button', '重试清理')
    assert.ok(!(await js(`document.body.textContent.includes('测试：上次临时文件清理失败')`)))
    await click('.nav-item', '生图预览')
    assert.equal(await js(`document.querySelectorAll('.page-library').length`), 0)
    await run(`document.querySelector('.pane-foot input[type=checkbox]').click()`)
    assert.equal(getSettings().naiAutoSave, true)
    await run(`document.querySelector('.pane-foot input[type=checkbox]').click()`)
    assert.equal(getSettings().naiAutoSave, false)
    await click('.gen-params-head button', '配置收藏')
    await wait(`!!document.querySelector('.recipe-dialog')`)
    await click('.recipe-save-current button', '收藏当前配置')
    const savedConfig = require('../../src/main/modules/images/recipes.ts').listRecipes()[0]
    assert.equal(savedConfig.sourceImage, '')
    assert.equal(savedConfig.thumbnail, '')
    assert.ok(
      await js(`document.querySelector('.recipe-load input').checked`),
      'loading defaults to exact saved seed',
    )
    assert.ok(
      await js(
        `(()=>{const d=document.querySelector('.recipe-dialog'),a=document.querySelector('.recipe-columns article'),f=document.querySelector('.recipe-load');return getComputedStyle(d).overflow==='hidden'&&a.getBoundingClientRect().right<d.getBoundingClientRect().right-16&&f.getBoundingClientRect().bottom<d.getBoundingClientRect().bottom})()`,
      ),
      'scrollbars stay inset; load action remains visible',
    )
    await click('.recipe-load button', '加载配置')
    await wait(`!document.querySelector('.recipe-dialog')`)
    const ordinary = await client.generateImages(
      { ...draft, version: 'v5', params },
      () => {},
      () => false,
    )
    win.webContents.send('gallery:changed')
    await pause(250)
    await run(
      `[...document.querySelectorAll('.gallery .thumb')].find(e=>e.querySelector('img').src.includes('${ordinary.images[0].name}')).click()`,
    )
    await run(`document.querySelector('.viewer .favorite-button').click()`)
    await wait(
      `document.querySelector('.viewer .favorite-button')?.getAttribute('aria-pressed')==='true'`,
    )
    await click('.gen-params-head button', '配置收藏')
    await wait(`!!document.querySelector('.recipe-dialog')`)
    await click('.recipe-item', 'grey shirt')
    await input('.recipe-columns article input', '可复用的灰衣配方')
    await click('.recipe-columns article button', '保存修改')
    assert.equal(
      require('../../src/main/modules/images/recipes.ts').listRecipes()[0].name,
      '可复用的灰衣配方',
    )
    await input('.recipe-columns aside input', '不存在的配方')
    assert.equal(await js(`document.querySelectorAll('.recipe-item').length`), 0)
    await input('.recipe-columns aside input', '灰衣')
    assert.equal(await js(`document.querySelectorAll('.recipe-item').length`), 1)
    await shot('13-recipe-library.png')
    await click('.recipe-dialog button', '加载配置')
    await wait(`!document.querySelector('.recipe-dialog')`)
    assert.equal(
      require('../../src/main/modules/images/library.ts').imageInfo(ordinary.images[0].name)
        .storage,
      'temporary',
      'favorite keeps an independent copy without changing source retention',
    )
    await click('.viewer button', '留存图片')
    assert.equal(
      require('../../src/main/modules/images/library.ts').imageInfo(ordinary.images[0].name)
        .storage,
      'saved',
    )
    await shot('14-retained-gallery.png')
    const earlierTemp = (
      await client.generateImages(
        { ...draft, version: 'v5', params },
        () => {},
        () => false,
      )
    ).images[0]
    await click('.run-bar button', '生成')
    await wait(`document.querySelector('.viewer')?.textContent.includes('留存最近一批剩余 1 张')`)
    const newest = await js(`document.querySelector('.viewer-stage img').getAttribute('src')`)
    await run(
      `[...document.querySelectorAll('.gallery .thumb')].find(e=>e.querySelector('img').src.includes('${earlierTemp.name}')).click()`,
    )
    assert.ok(
      !(await js(`document.querySelector('.viewer').textContent.includes('留存最近一批')`)),
      'earlier image cannot retain an unrelated latest batch',
    )
    await run(
      `[...document.querySelectorAll('.gallery .thumb')].find(e=>e.querySelector('img').getAttribute('src')===${JSON.stringify(newest)}).click()`,
    )
    await click('.viewer button', '留存最近一批')
    assert.equal(
      require('../../src/main/modules/images/library.ts').imageInfo(earlierTemp.name).storage,
      'temporary',
    )
    console.log(
      'PASS retention toggle, independent recipe creation, rename, search, reviewed apply and manual retain UI',
    )
    const beforeImageStart = pages.listPages().length
    const apiBefore = [aiInputs.length, generationInputs.length]
    await run(`document.querySelector('.gallery .thumb').click()`)
    const chosenUrl = await js(`document.querySelector('.viewer-stage img').getAttribute('src')`)
    await click('.viewer button', '用于新项目')
    await wait(`!!document.querySelector('.session-image img')`)
    assert.equal(
      await js(`document.querySelector('.session-image img').getAttribute('src')`),
      chosenUrl,
    )
    assert.equal(
      pages.listPages().length,
      beforeImageStart,
      'image handoff does not create a session',
    )
    await input('.session-create input', '图库起点测试')
    await shot('10-image-session-start.png')
    await click('.session-image button', '重新选择')
    await click('.viewer button', '用于新项目')
    await wait(`!!document.querySelector('.session-image img')`)
    assert.equal(
      await js(`document.querySelector('.session-create input').value`),
      '图库起点测试',
      'reselect preserves session name',
    )
    await click('.session-create button', '开始项目')
    await wait(`!!document.querySelector('.pw-shell')`)
    const fromImage = pages.listPages().find((p) => p.title === '图库起点测试')
    assert.ok(fromImage)
    assert.notEqual(fromImage.image.url, chosenUrl)
    assert.ok(
      readFileSync(client.imagePath(fromImage.image.name)).equals(
        readFileSync(client.imagePath(decodeURIComponent(chosenUrl.split('/').at(-1)))),
      ),
    )
    assert.deepEqual(
      [aiInputs.length, generationInputs.length],
      apiBefore,
      'starting from an image makes no model calls',
    )
    await run(`document.querySelector('[aria-label="返回项目"]').click()`)
    await click('.nav-item', '生图预览')
    await click('.viewer button', '用于新项目')
    await wait(`!!document.querySelector('.session-image img')`)
    await run(`document.querySelector('.session-create [title="取消新建"]').click()`)
    assert.equal(pages.listPages().length, beforeImageStart + 1, 'cancel creates no extra record')
    const n = pages.listPages().length
    await click('.nav-item', 'AI 工作台')
    await shot('00-session-list.png')
    const gridTop = await js(`document.querySelector('.session-grid').getBoundingClientRect().top`)
    await click('.sessions-home header button', '新建项目')
    assert.ok(await js(`document.querySelector('.project-dialog').matches(':modal')`))
    assert.equal(
      await js(`document.querySelector('.session-grid').getBoundingClientRect().top`),
      gridTop,
    )
    await shot('19-create-modal.png')
    await run(`document.querySelector('.project-dialog .theme-select').click()`)
    await wait(`!!document.querySelector('.theme-select-menu')`)
    assert.ok(
      await js(
        `(()=>{const m=document.querySelector('.theme-select-menu'),r=m.getBoundingClientRect();return !!m.closest('dialog')&&m.contains(document.elementFromPoint(r.x+10,r.y+10))})()`,
      ),
      'dropdown stays interactive in native modal',
    )
    await run(
      `document.querySelector('.project-dialog .theme-select').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    )
    assert.equal(pages.listPages().length, n, 'opening creation form creates nothing')
    await input('.session-create input', '通用创作会话测试')
    await click('.session-create button', '开始项目')
    await wait(`!!document.querySelector('.pw-shell')`)
    let ui = pages.listPages().find((p) => p.title === '通用创作会话测试')
    assert.ok(ui)
    assert.equal(ui.image, null)
    await shot('01-new-session.png')
    await click('.pw-rename', '通用创作会话测试')
    await input('.pw-heading input', '很长的创作项目名称'.repeat(10))
    await run(
      `document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    )
    for (const testWidth of [1440, 1100]) {
      win.setSize(testWidth, 960)
      await pause(150)
      assert.ok(
        await js(
          `(()=>{const h=document.querySelector('.pw-heading').getBoundingClientRect(),c=document.querySelector('.pw-conversation').getBoundingClientRect(),t=document.querySelector('.pw-rename b'),a=document.querySelector('.pw-header-actions').getBoundingClientRect();return Math.abs(h.left-c.left)<2&&Math.abs(h.width-c.width)<2&&a.right<=c.left&&t.scrollWidth>t.clientWidth&&getComputedStyle(t).textOverflow==='ellipsis'})()`,
        ),
        'title aligns with conversation and truncates without displacing navigation',
      )
      assert.ok(
        await js(
          `(()=>{const b=[...document.querySelectorAll('.pw-generation-actions .btn')].map(e=>e.getBoundingClientRect());return b.length===2&&Math.abs(b[0].height-b[1].height)<1&&Math.abs(b[0].top-b[1].top)<1})()`,
        ),
        'generation actions share one height and row',
      )
      await shot('21-header-' + testWidth + '.png')
    }
    win.setSize(1440, 960)
    await click('.pw-rename', '很长的创作项目名称')
    await input('.pw-heading input', '通用创作会话测试')
    await run(
      `document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    )
    await click('.pw-rename', '通用创作会话测试')
    await input('.pw-heading input', '取消后的名称')
    await shot('26-project-rename.png')
    await run(`document.querySelector('[aria-label="取消重命名"]').click()`)
    assert.equal(pages.readPage(ui.id).title, '通用创作会话测试')
    await click('.pw-rename', '通用创作会话测试')
    await input('.pw-heading input', '按钮保存名称')
    await run(`document.querySelector('[aria-label="保存项目名称"]').click()`)
    assert.equal(pages.readPage(ui.id).title, '按钮保存名称')
    await click('.pw-rename', '按钮保存名称')
    await input('.pw-heading input', '通用创作会话测试')
    await run(`document.querySelector('[aria-label="保存项目名称"]').click()`)
    const tooltipTarget = await js(
      `(()=>{const r=document.querySelector('[aria-label="引用此版"]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', ...tooltipTarget })
    await wait(`document.querySelector('.app-tooltip')?.matches(':popover-open')`)
    assert.ok(
      await js(
        `document.querySelector('.app-tooltip').textContent==='引用此版参与讨论'&&!document.querySelector('[aria-label="引用此版"]').hasAttribute('title')&&document.querySelector('[aria-label="引用此版"]').getAttribute('aria-describedby')==='app-tooltip'`,
      ),
      'styled tooltip replaces native title even for a disabled button',
    )
    await shot('27-workspace-tooltip.png')
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    assert.ok(!(await js(`document.querySelector('.app-tooltip')`)))
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 15, y: 50 })
    await pause(100)
    assert.equal(
      await js(`document.querySelector('[aria-label="引用此版"]').getAttribute('title')`),
      '引用此版参与讨论',
      'original title restored on exit',
    )
    mode = 'change'
    await input('.pw-input-wrap textarea', '我想生成一个灰色物体，保留主体轮廓')
    await run(`document.querySelector('.pw-send').click()`)
    await wait(
      `!!document.querySelector('.pw-thread .pw-proposal')&&!document.querySelector('.pw-thinking')`,
    )
    assert.ok(
      await js(
        `!!document.querySelector('.pw-blank')&&!document.querySelector('.pw-suggestion-board')`,
      ),
      'new proposal does not navigate away from canvas',
    )
    assert.equal(await js(`document.querySelectorAll('.pw-view-tabs button').length`), 4)
    assert.ok(await js(`!!document.querySelector('.pw-thread .pw-proposal[open]')`))
    assert.ok(
      await js(
        `!!document.querySelector('.markdown-text h2')&&!!document.querySelector('.markdown-text strong')&&!!document.querySelector('.markdown-text ol')&&!!document.querySelector('.markdown-text pre code')&&!!document.querySelector('.markdown-text table')`,
      ),
    )
    await run(`document.querySelector('.markdown-text a').click()`)
    assert.deepEqual(openedLinks, ['https://example.com/guide'])
    await shot('12-markdown-suggestion-tab.png')
    assert.equal(pageCurrent(pages.readPage(ui.id)).editor.draft.base, '')
    assert.ok(
      await js(
        `!document.querySelector('.pw-understanding') && !document.querySelector('.pw-header').textContent.includes('已保存到本机')`,
      ),
    )
    assert.ok(await js(`document.querySelector('.pw-header').getBoundingClientRect().height<=48`))
    assert.ok(
      await js(
        `document.querySelector('.skill-trigger').textContent.includes('已启用 3 个 Skill') && document.querySelector('.skill-trigger').getBoundingClientRect().height<50`,
      ),
    )
    await click('.pw-rename', '通用创作会话测试')
    await input('.pw-heading input', '会话重命名测试')
    await run(
      `document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    )
    assert.equal(pages.readPage(ui.id).title, '会话重命名测试')
    await click('.pw-rename', '会话重命名测试')
    await input('.pw-heading input', '通用创作会话测试')
    await run(
      `document.querySelector('.pw-heading input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    )
    await click('.pw-thread .pw-proposal[open] button', '采纳方案')
    assert.ok(await js(`!!document.querySelector('.workspace-prompt[data-editing="true"]')`))
    assert.ok(
      await js(
        `document.querySelector('.workspace-prompt .gen-advanced').textContent.includes('采样器')&&document.querySelector('.workspace-prompt .gen-params').textContent.includes('步数')`,
      ),
    )
    await shot('20-generation-config.png')
    assert.ok(
      await js(
        `document.querySelector('.workspace-prompt textarea').value.includes('grey object')`,
      ),
    )
    await shot('02-current-prompt.png')
    await click('.pw-execution button', '生成图片')
    await wait(`document.querySelector('.pw-scope-label')?.textContent.includes('版本 V1')`)
    await click('.pw-canvas-actions button', '区域批注')
    await wait(`document.querySelector('.ip-active-mask')?.getBoundingClientRect().width>100`)
    await pause(300)
    const bounds = await js(
      `(()=>{const r=document.querySelector('.ip-active-mask').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`,
    )
    const point = (x, y) => ({
      x: Math.round(bounds.x + bounds.w * x),
      y: Math.round(bounds.y + bounds.h * y),
    })
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point(0.2, 0.4) })
    await pause(30)
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      ...point(0.2, 0.4),
    })
    await pause(30)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point(0.25, 0.5) })
    await pause(30)
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      ...point(0.25, 0.5),
    })
    await pause(80)
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'right',
      clickCount: 1,
      ...point(0.23, 0.46),
    })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'right',
      clickCount: 1,
      ...point(0.23, 0.46),
    })
    await wait(`!!document.querySelector('.ip-context-menu')`)
    await click('.ip-context-menu button', '新增批注')
    await input('.ip-comment textarea', '我指的是这个位置')
    await click('.ip-comment button', '完成批注')
    await click('.ip-foot button', '保存并返回讨论')
    await wait(`!document.querySelector('.ip-dialog')`)
    assert.equal(pages.readPage(ui.id).execution.kind, 'generate')
    await wait(`document.querySelector('.pw-region-checklist input')?.checked`)
    // Explicitly unchecked regions remain unchecked after reopening the editor.
    await run(`document.querySelector('.pw-region-checklist input').click()`)
    await click('.pw-canvas-actions button', '区域批注')
    await wait(`!!document.querySelector('.ip-foot')`)
    await pause(200)
    await click('.ip-foot button', '保存并返回讨论')
    await wait(`!document.querySelector('.ip-dialog')`)
    assert.equal(await run(`document.querySelector('.pw-region-checklist input').checked`), false)
    await run(`document.querySelector('.pw-region-checklist input').click()`)
    mode = 'inpaint'
    await input('.pw-input-wrap textarea', '这次只重绘刚才的区域')
    await run(`document.querySelector('.pw-send').click()`)
    await wait(
      `document.querySelectorAll('.pw-thread .pw-proposal').length===2&&!document.querySelector('.pw-thinking')`,
    )
    await wait(
      `document.querySelector('.pw-thread .pw-proposal[open]')?.textContent.includes('局部重绘')`,
    )
    await click('.pw-thread .pw-proposal[open] button', '采纳方案')
    assert.equal(pages.readPage(ui.id).execution.kind, 'inpaint')
    await shot('03-proposal-and-execution.png')
    await click('.pw-execution button', '返回查看')
    await click('.pw-view-tabs button', '画布')
    await shot('04-mask-review.png')
    await click('.pw-execution button', '执行重绘')
    await wait(`document.querySelector('.pw-scope-label')?.textContent.includes('版本 V2')`)
    assert.equal(pages.readPage(ui.id).currentVersionId, pages.readPage(ui.id).versions[1].id)
    await click('.pw-scope-bar[data-historical="true"] button', '设为蓝本')
    await wait(`!document.querySelector('.pw-scope-bar[data-historical="true"]')`)
    await run(`document.querySelector('.pw-thread .pw-proposal').open=true`)
    assert.ok(
      await js(`!!document.querySelector('.pw-viewport')`),
      'opening an old proposal does not replace the image pane',
    )
    await click('.pw-view-tabs button', '修改对比')
    assert.ok(
      await js(`!document.querySelector('.pw-change-board article.pw-proposal')`),
      'AI suggestions are separate from iteration history',
    )
    assert.ok(
      await js(
        `document.querySelector('.pw-scope-label').textContent.includes('版本 V2')&&!document.querySelector('.wi-heading')`,
      ),
    )
    assert.equal(await js(`document.querySelectorAll('.wi-images img').length`), 2)
    assert.equal(
      await js(`document.querySelectorAll('.wi-timeline').length`),
      0,
      'only the sidebar selects version groups',
    )
    await run(`document.querySelector('.wi-mask').open=true`)
    await shot('11-iteration-history.png')
    await run(`document.querySelector('[aria-label="版本记录"]').click()`)
    await click('.pw-version b', '版本 V1')
    assert.ok(await js(`document.querySelector('.pw-scope-label').textContent.includes('版本 V1')`))
    assert.equal(
      pages.readPage(ui.id).currentVersionId,
      pages.readPage(ui.id).versions[2].id,
      'review does not switch current version',
    )
    await click('.pw-version b', '版本 V2')
    await run(`document.querySelector('[aria-label="版本记录"]').click()`)
    await click('.pw-view-tabs button', '生图配置')
    await click('.pw-execution button', '编辑配置')
    const sharedValues = await js(
      `[...document.querySelectorAll('.view textarea,.view .char-head input')].map(e=>e.value)`,
    )
    const moveCharacter = async (x, y) => {
      if (!(await js(`!!document.querySelector('.workspace-prompt .char-block')`))) {
        await click('.workspace-prompt button', '添加角色')
      }
      await input(
        '.workspace-prompt .char-block textarea',
        'A person stands at the selected position.',
      )
      await run(
        `document.querySelector('.workspace-prompt .char-block [title="在画布上拖动位置"]').click()`,
      )
      await wait(`!!document.querySelector('.pos-reference-image')`)
      await pause(250)
      const r = await js(
        `(()=>{const r=document.querySelector('.pos-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`,
      )
      const pt = { x: Math.round(r.x + r.w * x), y: Math.round(r.y + r.h * y) }
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pt })
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pt })
      await pause(100)
      assert.equal(await js(`document.querySelector('.pos-input').value`), `${x},${y}`)
      const dot = await js(
        `(()=>{const r=document.querySelector('.pos-dot').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      )
      const moved = { x: Math.round(r.x + r.w * 0.4), y: Math.round(r.y + r.h * 0.5) }
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...dot })
      win.webContents.sendInputEvent({ type: 'mouseMove', ...moved })
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...moved })
      await pause(100)
      assert.equal(
        await js(`document.querySelector('.pos-input').value`),
        '0.4,0.5',
        'drag writes local character coordinates',
      )
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await pause(50)
      assert.equal(
        await js(`document.querySelector('.pos-input').value`),
        '0.41,0.5',
        'arrow key nudges local coordinates',
      )
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pt })
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pt })
      await pause(80)

      assert.equal(
        await js(`document.querySelector('.pos-reference-image').getAttribute('src')`),
        pageCurrent(pages.readPage(ui.id)).image.url,
      )
      await shot('07-workspace-position.png')
      await click('.pos-foot button', '完成')
      await wait(`!document.querySelector('.pos-mask')`)
      assert.equal(
        await js(`document.querySelector('.workspace-prompt .char-head input').value`),
        `${x},${y}`,
      )
      assert.deepEqual(
        await js(
          `[...document.querySelectorAll('.view textarea,.view .char-head input')].map(e=>e.value)`,
        ),
        sharedValues,
        'local position editor does not modify shared prompts',
      )
      await run(
        `document.querySelector('.workspace-prompt .char-block').scrollIntoView({block:'start'})`,
      )
      await shot('08-character-layout.png')
    }
    await moveCharacter(0.25, 0.7)
    const countBeforeBlocked = pages.listPages().length
    await click('.nav-item', '生图预览')
    await click('.viewer button', '用于新项目')
    await wait(`!!document.querySelector('.pw-error')`)
    assert.ok(
      await js(
        `!!document.querySelector('.workspace-prompt[data-editing="true"]')&&!document.querySelector('.session-create')`,
      ),
      'image handoff preserves an unsaved editor',
    )
    assert.equal(pages.listPages().length, countBeforeBlocked)
    await run(`document.querySelector('.pw-error button').click()`)

    const longPrompt = Array(35)
      .fill('A long prompt with details about the subject and background.')
      .join('\n')
    await input('.workspace-prompt textarea', longPrompt)
    await pause(100)
    assert.ok(
      await js(
        `(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.clientHeight>600 && t.scrollHeight<=t.clientHeight+1})()`,
      ),
      'long prompt expands without internal scrolling',
    )
    await run(`document.querySelector('.workspace-prompt').scrollTop=100000`)
    assert.ok(
      await js(
        `(()=>{const b=document.querySelector('.pw-config-back');const r=b.getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight})()`,
      ),
      'return stays in the fixed bottom toolbar',
    )
    win.setSize(1100, 760)
    await pause(300)
    await shot('06-long-prompt-toolbar.png')
    assert.ok(
      await js(
        `(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.scrollHeight<=t.clientHeight+1})()`,
      ),
      'resize recalculates wrapping',
    )
    await click('.nav-item', 'Tag 搜索')
    await click('.nav-item', 'AI 工作台')
    await pause(100)
    assert.ok(
      await js(
        `(()=>{const t=document.querySelector('.workspace-prompt textarea');return t.scrollHeight<=t.clientHeight+1})()`,
      ),
      'hidden pane resumes correct height',
    )
    await click('.pw-execution button', '返回查看')
    assert.equal(
      pageCurrent(pages.readPage(ui.id)).editor.draft.characters.length,
      1,
      'return saves manual changes',
    )
    await click('.pw-execution button', '编辑配置')
    await moveCharacter(0.3, 0.6)
    await input('.workspace-prompt textarea', 'A revised grey object stands on a table.')
    assert.ok(
      await js(`document.querySelector('.workspace-prompt textarea').clientHeight<200`),
      'short prompt shrinks back',
    )
    await run(`document.querySelector('.workspace-prompt .gen-advanced').open=true`)
    await input('.workspace-prompt .gen-advanced input[type=range]', '0.4')
    await run(`document.querySelector('.workspace-prompt [aria-label="采样器"]').click()`)
    await run(
      `[...document.querySelectorAll('.theme-select-option')].find(e=>e.querySelector('span').textContent==='Euler').click()`,
    )
    await run(`document.querySelector('.workspace-prompt [aria-label="噪声调度"]').click()`)
    await click('.theme-select-option', 'karras')
    win.setSize(1440, 960)
    await pause(150)
    await click('.pw-execution button', '返回查看')
    await wait(`!document.querySelector('.workspace-prompt[data-editing="true"]')`)
    const saved = pages.readPage(ui.id)
    assert.equal(pageCurrent(saved).editor.params.cfgRescale, 0.4)
    assert.equal(pageCurrent(saved).editor.params.sampler, 'k_euler')
    assert.equal(pageCurrent(saved).editor.params.noiseSchedule, 'karras')
    assert.equal(pageCurrent(saved).editor.draft.characters[0].position, '0.3,0.6')
    assert.ok(saved.messages.some((m) => m.draftBefore))
    assert.notEqual(pageCurrent(saved).generated.draft.base, pageCurrent(saved).editor.draft.base)
    await click('.pw-view-tabs button', '修改对比')
    await shot('09-context-diff.png')
    assert.equal(
      await js(`document.querySelectorAll('.pw-change-board .pw-proposal,.wi-settings').length`),
      0,
      'comparison contains only generation differences, not full settings or draft audit history',
    )

    mode = 'change'
    for (const text of ['给当前版本一个新建议', '再给一份最新建议']) {
      const count = await js(`document.querySelectorAll('.pw-message.assistant').length`)
      await input('.pw-input-wrap textarea', text)
      await run(`document.querySelector('.pw-send').click()`)
      await wait(
        `document.querySelectorAll('.pw-message.assistant').length===${count + 1}&&!document.querySelector('.pw-thinking')`,
      )
    }
    assert.ok(
      await js(`!!document.querySelector('.pw-change-board')`),
      'new suggestions do not interrupt comparison',
    )
    const latest = pages.readPage(ui.id)
    assert.ok(
      latest.messages.filter((m) => m.proposal && m.versionId === latest.currentVersionId).length >=
        2,
    )
    assert.ok(
      await js(
        `!!document.querySelector('.pw-change-board')&&!document.querySelector('.pw-suggestion-board')`,
      ),
    )
    const pendingIds = latest.messages
      .filter((m) => m.proposal?.status === 'pending' && !m.proposal.superseded)
      .map((m) => m.id)
    assert.equal(pendingIds.length, 1)
    assert.ok(
      await js(`document.getElementById('proposal-'+${JSON.stringify(pendingIds[0])}).open`),
      'latest pending proposal expands without changing the pane',
    )
    await shot('13-latest-suggestion.png')
    await run(`document.querySelector('[aria-label="版本记录"]').click()`)
    assert.ok(
      await js(
        `!document.querySelector('.pw-history').textContent.includes('种子')&&!document.querySelector('.pw-history').textContent.includes('点击查看')`,
      ),
    )
    await click('.pw-version b', '版本 V1')
    await wait(`!!document.querySelector('.pw-scope-bar[data-historical="true"]')`)
    await run(`document.querySelector('[aria-label="引用此版"]').click()`)
    mode = 'discuss'
    await input('.pw-input-wrap textarea', '参考这版，先讨论')
    await run(`document.querySelector('.pw-send').click()`)
    await wait(`!document.querySelector('.pw-thinking')`)
    assert.equal(aiInputs.at(-1).input.currentVersion.label, '方案 V2 · 候选 1')
    assert.equal(aiInputs.at(-1).input.referencedVersions[0].label, '方案 V1 · 候选 1')
    assert.equal(
      aiInputs.at(-1).input.discussion.label,
      '方案 V1 · 候选 1',
      'the visible historical image is sent without adopting it',
    )
    assert.equal(aiInputs.at(-1).input.editTarget.versionId, pages.readPage(ui.id).currentVersionId)
    assert.equal(
      aiInputs.at(-1).parts.filter((p) => p.type === 'image_url').length,
      2,
      'discussion and explicit reference do not duplicate image bytes',
    )
    assert.ok(
      await js(
        `document.querySelector('.pw-discussion-context').textContent.includes('方案 V1 · 候选 1')`,
      ),
    )
    win.setSize(1100, 760)
    await pause(150)
    assert.ok(
      await js(
        `(()=>{const r=document.querySelector('.pw-discussion-context').getBoundingClientRect(),b=document.querySelector('.pw-send').getBoundingClientRect();return r.right<=innerWidth&&b.bottom<=innerHeight})()`,
      ),
      'discussion context and send button fit compact layouts',
    )
    await shot('16-discussion-target.png')
    win.setSize(1440, 960)
    await pause(150)
    await click('.pw-scope-bar[data-historical="true"] button', '设为蓝本')
    await wait(`!document.querySelector('.pw-scope-bar[data-historical="true"]')`)
    await input('.pw-input-wrap textarea', '下次继续调整')
    await run(`document.querySelector('[aria-label="返回项目"]').click()`)
    await wait(`!document.querySelector('.pw-shell')`)
    await click('.session-open', '通用创作会话测试')
    await wait(`!!document.querySelector('.pw-shell')`)
    assert.equal(
      await js(`document.querySelector('.pw-input-wrap textarea').value`),
      '下次继续调整',
    )
    assert.equal(await js(`document.querySelector('.pw-scope-label b').textContent`), '版本 V1')
    win.setSize(1100, 760)
    await pause(300)
    await shot('05-compact-session.png')
    assert.ok(
      await js(
        `document.querySelector('.pw-shell').scrollWidth<=document.querySelector('.pw-shell').clientWidth+1`,
      ),
    )
    await run(`document.querySelector('[aria-label="返回项目"]').click()`)
    await wait(`!document.querySelector('.pw-shell')`)
    const missingDoc = pages.readPage(ui.id)
    const missingVersion = pageCurrent(missingDoc)
    const missingPath = client.imagePath(missingVersion.image.name)
    const missingBytes = readFileSync(missingPath)
    require('node:fs').unlinkSync(missingPath)
    await click('.session-open', '通用创作会话测试')
    await wait(`document.querySelector('.pw-blank')?.textContent.includes('图片文件缺失')`)
    assert.equal(
      await js(`document.querySelectorAll('.pw-historical-prompt,.recipe-dialog').length`),
      0,
    )
    assert.ok(
      !(await js(`document.querySelector('.pw-canvas-column').textContent.includes('配置收藏')`)),
    )
    await shot('15-missing-image.png')
    await run(`document.querySelector('[aria-label="返回项目"]').click()`)
    writeFileSync(missingPath, missingBytes)
    const beforeRolls = pages.readPage(ui.id)
    pages.editPage(ui.id, beforeRolls.revision, {
      type: 'execution',
      execution: { kind: 'generate', regionId: null },
    })
    await click('.session-open', '通用创作会话测试')
    await wait(`!!document.querySelector('.pw-shell')`)
    for (let i = 0; i < 2; i++) {
      if (await js(`!!document.querySelector('.pw-context button')`)) {
        await click('.pw-context button', '回到当前')
      }
      await click('.pw-execution button', '生成图片')
      await wait(`!document.querySelector('.pw-run-progress')`)
      await pause(200)
    }
    const rolled = pages.readPage(ui.id)
    const latestGroup = require('../../src/shared/workspace/model.ts').pageGroups(rolled).at(-1)
    assert.equal(latestGroup.versions.length, 2, 'unchanged configuration stays in one version')
    await run(`document.querySelector('[aria-label="版本记录"]').click()`)
    assert.equal(
      await js(`document.querySelectorAll('.pw-version').length`),
      require('../../src/shared/workspace/model.ts').pageGroups(rolled).length,
      'sidebar shows one entry per version',
    )
    await run(`document.querySelector('[aria-label="本版图片"]').click()`)
    await wait(`!!document.querySelector('.pw-candidates')`)
    assert.equal(await js(`document.querySelectorAll('.pw-candidate img').length`), 2)
    await shot('21-candidate-gallery.png')
    await run(`document.querySelector('.pw-candidate-open').click()`)
    const previewBounds = await js(
      `(()=>{const r=document.querySelector('.pw-viewport').getBoundingClientRect();return [r.y,r.height]})()`,
    )
    assert.ok(
      await js(
        `!!document.querySelector('.pw-execution')&&!document.querySelector('.pw-execution .btn.accent').disabled`,
      ),
      'historical preview keeps next-generation controls independent',
    )
    assert.equal(
      pages.readPage(ui.id).currentVersionId,
      rolled.currentVersionId,
      'previewing another roll does not adopt it',
    )
    await shot('16-version-candidates.png')
    await click('.pw-scope-bar[data-historical="true"] button', '设为蓝本')
    await wait(`!document.querySelector('.pw-scope-bar[data-historical="true"]')`)
    assert.equal(pages.readPage(ui.id).currentVersionId, latestGroup.versions[0].id)
    assert.deepEqual(
      await js(
        `(()=>{const r=document.querySelector('.pw-viewport').getBoundingClientRect();return [r.y,r.height]})()`,
      ),
      previewBounds,
      'adopting a preview does not resize or move the canvas',
    )
    const beforeClear = pages.readPage(ui.id)
    const clearedImage = pageCurrent(beforeClear).image.name
    const clearedSnapshot = pageCurrent(beforeClear).generated
    const otherCandidate = latestGroup.versions.find((v) => v.id !== beforeClear.currentVersionId)
    const cardSelector = `.pw-candidate[data-version-id="${otherCandidate.id}"]`
    await run(`document.querySelector('[aria-label="本版图片"]').click()`)
    await wait(`!!document.querySelector('.pw-candidates')`)
    assert.ok(
      !(await js(`document.querySelector('.pw-scope-actions [aria-label="清理图片"]')`)),
      'deletion is only in candidate gallery',
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 15, y: 50 })
    await pause(200)
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('${cardSelector} .pw-candidate-delete')).opacity`,
      ),
      '0',
      'delete icon hidden before hover',
    )
    const hoverCard = await js(
      `(()=>{const r=document.querySelector('${cardSelector}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+30)}})()`,
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverCard })
    await pause(200)
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('${cardSelector} .pw-candidate-delete')).opacity`,
      ),
      '1',
      'hover reveals that card delete icon',
    )
    await shot('25-workspace-gallery-hover-delete.png')
    await run(`document.querySelector('${cardSelector} .pw-candidate-delete').click()`)
    assert.ok(await js(`!!document.querySelector('.pw-candidates')`), 'delete does not open canvas')
    await click('.pw-candidate-delete-confirm button', '取消')
    assert.ok(client.imagePath(otherCandidate.image.name), 'cancelling keeps target image')
    await run(`document.querySelector('${cardSelector} .pw-candidate-delete').click()`)
    await click('.pw-candidate-delete-confirm button', '确认删除')
    await wait(`document.querySelectorAll('.pw-candidate').length===1`)
    assert.equal(
      client.imagePath(otherCandidate.image.name),
      null,
      'deletes hovered candidate, not current preview',
    )
    assert.ok(client.imagePath(clearedImage))
    assert.equal(pages.readPage(ui.id).currentVersionId, beforeClear.currentVersionId)
    assert.ok(
      await js(`!!document.querySelector('.pw-candidates')`),
      'stays in gallery for continued cleanup',
    )
    await run(`document.querySelector('.pw-candidate-delete').click()`)
    await click('.pw-candidate-delete-confirm button', '确认删除')
    await wait(`!!document.querySelector('.pw-candidates-empty')`)
    assert.equal(client.imagePath(clearedImage), null)
    assert.equal(pages.readPage(ui.id).versions.length, beforeClear.versions.length)
    assert.deepEqual(pageCurrent(pages.readPage(ui.id)).generated, clearedSnapshot)
    await click('.pw-view-tabs button', '生图配置')
    assert.ok(
      await js(`!!document.querySelector('.workspace-prompt')`),
      'cleared image keeps readable generation snapshot',
    )
    await run(`document.querySelector('[aria-label="返回项目"]').click()`)
    await wait(`!document.querySelector('.pw-shell')`)
    await run(
      `(()=>{const card=[...document.querySelectorAll('.session-card')].find(e=>e.textContent.includes('通用创作会话测试'));card.querySelector('.session-delete').click()})()`,
    )
    await wait(`document.querySelector('.session-delete-popover')?.matches(':popover-open')`)
    assert.ok(
      await js(`!document.querySelector('.project-dialog').open`),
      'delete confirmation is not a modal',
    )
    const countBeforeDelete = pages.listPages().length
    await shot('22-delete-popover.png')
    await click('.session-delete-popover button', '取消')
    assert.equal(pages.listPages().length, countBeforeDelete, 'cancel never deletes')
    await run(
      `(()=>{const card=[...document.querySelectorAll('.session-card')].find(e=>e.textContent.includes('通用创作会话测试'));card.querySelector('.session-delete').click()})()`,
    )
    ipcMain.removeHandler('pages:delete')
    ipcMain.handle('pages:delete', () => {
      throw Error('fixture delete failure')
    })
    await click('.session-delete-popover button', '确认删除')
    await wait(
      `document.querySelector('.session-delete-popover .delete-error')?.textContent.includes('fixture delete failure')`,
    )
    assert.equal(pages.listPages().length, countBeforeDelete)
    assert.ok(
      await js(`document.querySelector('.session-delete-popover').matches(':popover-open')`),
      'failed deletion remains retryable locally',
    )
    ipcMain.removeHandler('pages:delete')
    ipcMain.handle('pages:delete', async (e, id, revision) => {
      try {
        await cleanup.deletePageWithImages(id, revision)
      } finally {
        e.sender.send('gallery:changed')
      }
    })
    await click('.session-delete-popover button', '确认删除')
    assert.ok(!pages.listPages().some((s) => s.id === ui.id))
    assert.equal(
      client.imagePath(pageCurrent(saved).image.name),
      null,
      'deleting the project cleans its generated images',
    )
    assert.ok(
      await js(
        `!document.querySelector('.session-delete-popover').matches(':popover-open')&&!document.querySelector('.pw-shell')`,
      ),
      'successful deletion stays on the project list',
    )
    // Further deletions use the adjacent card directly; no recycle UI or recycle read dependency.
    ipcMain.removeHandler('pages:removed')
    await click('.nav-item', 'Tag 搜索')
    await click('.nav-item', 'AI 工作台')
    assert.ok(
      await js(
        `!document.querySelector('.sessions-home header').textContent.includes('已删除')&&!document.querySelector('.sessions-home .error-box')`,
      ),
    )
    await run(`document.querySelector('.session-delete').click()`)
    await wait(`document.querySelector('.session-delete-popover').matches(':popover-open')`)
    await click('.session-delete-popover button', '确认删除')
    assert.equal(
      pages.listPages().length,
      countBeforeDelete - 2,
      'consecutive deletes require no modal navigation',
    )
    assert.equal(
      await js(`document.querySelectorAll('.session-card').length`),
      pages.listPages().length,
    )
    assert.ok(pages.listRemovedPages().length >= 2, 'existing recovery data is not purged')
    console.log(
      'PASS anchored delete confirmation, cancel, failure retry, consecutive deletes, preserved recovery data and no recycle listing dependency',
    )
    console.log(
      'PASS compact Skill count, 46px header, explicit rename, growing textareas, pinned save/cancel, resize and hidden-pane recovery; independent UI, intentional creation, conversation-derived goals, final prompt, review panel, annotation/mode separation, generation, manual history, reference/restore, reopen and deletion at 1440/1100 widths',
    )
    await click('.sessions-home header button', '清理遗留图片')
    await wait(`document.querySelector('.session-delete-popover').matches(':popover-open')`)
    assert.ok(
      await js(`document.querySelector('.delete-project-detail').textContent.includes('其他项目')`),
    )
    await click('.session-delete-popover button', '确认清理')
    await wait(`!document.querySelector('.session-delete-popover').matches(':popover-open')`)
    console.log(
      'PASS workspace image cleanup, preserved version snapshots, project image removal and legacy cleanup entry',
    )
    // Isolate deletion UI from real files and the OS recycle bin.
    const deleteFixtures = (
      await client.generateImages(
        { ...draft, version: 'v5', params: { ...params, count: 2 } },
        () => {},
        () => false,
      )
    ).images
    let deleteGallery = deleteFixtures.map((g) => ({ ...g, storage: 'temporary' }))
    let deleteCalls = 0
    let deleteFails = true
    ipcMain.removeHandler('nai:list')
    ipcMain.handle('nai:list', () => deleteGallery)
    ipcMain.handle('nai:delete', async (_e, name) => {
      deleteCalls++
      await pause(150)
      if (deleteFails) {
        throw new Error('fixture gallery delete failure')
      }
      deleteGallery = deleteGallery.filter((g) => g.name !== name)
      return true
    })
    await click('.nav-item', '生图预览')
    win.webContents.send('gallery:changed')
    await wait(`document.querySelectorAll('.gallery .thumb').length===2`)
    await run(`document.querySelector('.gallery .thumb').click()`)
    const firstDeleteUrl = await js(
      `document.querySelector('.viewer-stage img').getAttribute('src')`,
    )
    await click('.viewer button', '删除图片')
    assert.equal(deleteCalls, 0, 'first click only asks for confirmation')
    await click('.viewer button', '确认删除')
    await pause(200)
    assert.equal(
      await js(`document.querySelector('.viewer-stage img').getAttribute('src')`),
      firstDeleteUrl,
      'failed deletion preserves preview',
    )
    assert.equal(await js(`document.querySelectorAll('.gallery .thumb').length`), 2)
    deleteFails = false
    await click('.viewer button', '删除图片')
    await run(`document.querySelectorAll('.gallery .thumb')[1].click()`)
    assert.ok(
      !(await js(`document.querySelector('.viewer .danger-confirm')`)),
      'switching images resets confirmation',
    )
    await run(`document.querySelector('.viewer-stage').click()`)
    await wait(`!!document.querySelector('.image-viewer')`)
    const pressDelete = (repeat = false) =>
      run(
        `document.querySelector('.image-viewer').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',repeat:${repeat},bubbles:true,cancelable:true}))`,
      )
    await pressDelete()
    await pressDelete(true)
    assert.equal(deleteCalls, 1, 'holding Delete cannot confirm deletion')
    await shot('23-gallery-delete-confirm.png')
    await pressDelete()
    await wait(`document.querySelectorAll('.gallery .thumb').length===1`)
    assert.equal(deleteCalls, 2)
    assert.ok(
      await js(
        `!!document.querySelector('.image-viewer')&&!document.querySelector('.iv-delete.danger-confirm')`,
      ),
      'deletion advances and clears confirmation',
    )
    assert.equal(
      await js(`document.querySelector('.viewer-stage img').getAttribute('src')`),
      firstDeleteUrl,
    )
    await click('.iv-delete', '删除图片')
    await click('.iv-delete', '确认删除')
    await wait(`!document.querySelector('.image-viewer')&&!document.querySelector('.viewer')`)
    assert.equal(deleteCalls, 3)
    assert.equal(
      await js(`document.querySelectorAll('.gallery .thumb').length`),
      0,
      'deleting last image clears preview and viewer',
    )
    deleteGallery = [{ ...deleteFixtures[0], storage: 'workspace' }]
    win.webContents.send('gallery:changed')
    await wait(`document.querySelectorAll('.gallery .thumb').length===1`)
    await run(`document.querySelector('.gallery .thumb').click()`)
    assert.ok(
      await js(
        `document.querySelector('.gallery-delete').disabled && document.querySelector('.thumb-actions [aria-label="删除"]').disabled && document.querySelector('.gallery-delete-note').textContent.includes('工作台引用中')`,
      ),
      'protected images keep a visible disabled delete entry with explanation',
    )
    await run(`document.querySelector('.viewer-stage').click()`)
    await wait(`!!document.querySelector('.image-viewer')`)
    await pressDelete()
    assert.equal(deleteCalls, 3, 'workspace archives cannot be deleted with shortcut')
    assert.ok(
      await js(
        `document.querySelector('.iv-delete').disabled && document.querySelector('.iv-hint').textContent.includes('工作台引用中')`,
      ),
    )
    await shot('24-protected-gallery-delete.png')
    await run(`document.querySelector('.image-viewer [aria-label="关闭图片预览"]').click()`)
    await wait(`!document.querySelector('.image-viewer')`)
    console.log(
      'PASS gallery preview and fullscreen deletion, confirmation reset, failure recovery, repeat-key guard, adjacent selection, last-image close and workspace protection',
    )
    console.log('Artifacts:', artifacts)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
    if (win) {
      writeFileSync(join(artifacts, 'failure.png'), (await win.webContents.capturePage()).toPNG())
      writeFileSync(
        join(artifacts, 'failure.txt'),
        await win.webContents.executeJavaScript('document.body.innerText'),
      )
    }
  } finally {
    app.exit(process.exitCode || 0)
  }
})
