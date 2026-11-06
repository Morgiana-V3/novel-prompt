// MCP 收藏、提示词片段与图片反推工具：与界面共用数据和识别实例，参数校验与结果格式。
const assert = require('node:assert/strict')
const { app } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { PNG } = require('pngjs')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-mcp-library-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const { libraryTools } = require('../../src/main/adapters/mcp/tools/library.ts')
const { createReadImagePromptTool } = require('../../src/main/adapters/mcp/tools/images.ts')
const { createMcpSession } = require('../../src/main/adapters/mcp/server.ts')
const { toolOutputSchema } = require('../../src/main/adapters/mcp/output-schemas.ts')
const { toolGroup } = require('../../src/main/adapters/mcp/tool-groups.ts')
const { setReverseRuntime } = require('../../src/main/modules/reverse/runtime.ts')
const { imageDir } = require('../../src/main/modules/images/access.ts')
const { embedRecipe } = require('../../src/main/modules/images/png-record.ts')
const recipes = require('../../src/main/modules/images/recipes.ts')

const tools = Object.fromEntries(libraryTools().map((tool) => [tool.name, tool]))
const call = async (name, args = {}, signal = new AbortController().signal) =>
  JSON.parse(await tools[name].run(args, signal, () => {}))

const recipe = {
  schema: 1,
  createdAt: 123456,
  sourceKind: 'generate',
  request: {
    base: '1girl, silver hair, cherry blossoms',
    negative: 'blurry',
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
      seed: 42,
      count: 1,
      qualityTags: false,
      ucPreset: 'none',
    },
  },
}

app.whenReady().then(async () => {
  try {
    // 工具都有输出格式，并归入既有分组
    for (const tool of Object.values(tools)) {
      assert.ok(toolOutputSchema(tool.name), `${tool.name} has an output schema`)
    }
    assert.equal(toolGroup('list_snippets'), 'tags')
    assert.equal(toolGroup('save_favorite'), 'images')
    assert.equal(toolGroup('reverse_image'), 'images')
    assert.equal(tools.delete_favorite.annotations.destructiveHint, true)
    assert.equal(tools.delete_snippet.annotations.destructiveHint, true)

    /* ---------- 提示词片段 ---------- */
    const created = await call('save_snippet', {
      name: '厚涂画风',
      text: 'thick painting, realistic lighting',
      category: '画风',
    })
    assert.equal(created.outcome, 'created')
    let listed = await call('list_snippets', { query: 'thick' })
    assert.deepEqual(
      listed.items.map((item) => item.name),
      ['厚涂画风'],
    )
    assert.deepEqual(listed.categories, ['画风'])
    const updated = await call('save_snippet', {
      id: created.snippet.id,
      name: '厚涂画风',
      text: 'impasto',
      category: '画风',
    })
    assert.equal(updated.outcome, 'updated')
    assert.equal((await call('list_snippets')).items[0].text, 'impasto')
    await assert.rejects(call('save_snippet', { id: randomUUID(), name: 'x', text: 'y' }), /不存在/)
    await assert.rejects(call('delete_snippet', { id: 'missing' }), /片段不存在/)
    await call('delete_snippet', { id: created.snippet.id })
    listed = await call('list_snippets')
    assert.equal(listed.items.length, 0)
    console.log('PASS snippets can be listed, created, updated and deleted')

    /* ---------- 收藏 ---------- */
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(200)
    const imageName = `${randomUUID()}.png`
    writeFileSync(join(imageDir(), imageName), embedRecipe(PNG.sync.write(png), recipe))
    // Exercise the real protocol output contract, not just the tool's implementation.
    let resolvePrompt
    const promptSession = createMcpSession(
      [createReadImagePromptTool()],
      { name: 'image-metadata-test', version: '1', instructions: '' },
      (line) => resolvePrompt(JSON.parse(line)),
    )
    for (const argumentsRecord of [{ name: imageName }, { path: join(imageDir(), imageName) }]) {
      const response = new Promise((resolve) => (resolvePrompt = resolve))
      promptSession.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'read_image_prompt', arguments: argumentsRecord },
        }),
      )
      const { result } = await response
      assert.equal(result.isError, undefined)
      assert.equal(result.structuredContent.base, recipe.request.base)
      assert.equal(result.structuredContent.negative, recipe.request.negative)
      assert.equal(result.structuredContent.width, recipe.request.params.width)
      assert.equal(result.structuredContent.height, recipe.request.params.height)
    }
    promptSession.close()
    console.log('PASS read_image_prompt restores stored PNG metadata through MCP by name and path')
    await assert.rejects(call('save_favorite', { image_name: 'missing.png' }), /图库中没有/)
    const saved = await call('save_favorite', {
      image_name: imageName,
      name: '樱花银发',
      tags: ['人物'],
    })
    assert.equal(saved.outcome, 'saved')
    assert.equal(saved.favorite.name, '樱花银发')
    assert.deepEqual(saved.favorite.tags, ['人物'])
    assert.equal(saved.favorite.hasImage, true)
    assert.equal(recipes.listRecipes().length, 1, 'shares the favorites store with the UI')
    const found = await call('list_favorites', { query: 'cherry' })
    assert.equal(found.total, 1)
    assert.deepEqual(found.tags, ['人物'])
    assert.equal((await call('list_favorites', { tag: '风景' })).total, 0)
    const full = await call('get_favorite', { id: saved.favorite.id })
    assert.deepEqual(full.request, recipe.request)
    assert.ok(full.imagePath?.endsWith('.png'))
    const renamed = await call('update_favorite', { id: saved.favorite.id, note: '保留种子' })
    assert.equal(renamed.favorite.name, '樱花银发', 'omitted fields are kept')
    assert.equal(renamed.favorite.note, '保留种子')
    await assert.rejects(call('get_favorite', { id: randomUUID() }), /收藏不存在/)
    await call('delete_favorite', { id: saved.favorite.id })
    assert.equal(recipes.listRecipes().length, 0)
    console.log('PASS favorites can be saved from the gallery, read, updated and deleted')

    /* ---------- 图片反推 ---------- */
    let received
    let cancelled = 0
    setReverseRuntime({
      analyze: async (bytes, models, report) => {
        received = { size: bytes.length, models }
        report('正在识别')
        return {
          tags: Array.from({ length: 80 }, (_, i) => ({ name: `tag ${i}`, score: 1 - i / 100 })),
          characters: [{ name: 'hatsune miku', score: 0.9 }],
          characterModel: 'wd',
          artists: [{ model: 'Kaloscope 3', tags: [{ name: 'wlop', score: 0.4 }] }],
          seconds: 1.5,
          warnings: [],
          style: [0.1, 0.2],
        }
      },
      cancel: () => cancelled++,
    })
    const reversed = await call('reverse_image', { image_name: imageName, limit: 10 })
    assert.deepEqual(received.models, ['k2', 'k3', 'wd'])
    assert.ok(received.size > 0)
    assert.equal(reversed.tags.length, 10)
    assert.equal(reversed.artists[0].tags[0].name, 'wlop')
    assert.equal('style' in reversed, false, 'style embedding is not exposed')
    await call('reverse_image', { image_name: imageName, models: ['wd'] })
    assert.deepEqual(received.models, ['wd'])
    await assert.rejects(call('reverse_image', {}), /二选一/)
    await assert.rejects(call('reverse_image', { path: 'relative.png' }), /绝对路径/)
    await assert.rejects(call('reverse_image', { image_name: imageName, models: ['bad'] }))
    // 取消 Agent 任务时停止识别进程
    setReverseRuntime({
      analyze: () => new Promise(() => {}),
      cancel: () => cancelled++,
    })
    const controller = new AbortController()
    const pending = call('reverse_image', { image_name: imageName }, controller.signal)
    controller.abort()
    assert.equal(cancelled, 1)
    void pending.catch(() => {})
    console.log('PASS reverse_image uses the shared recognition runtime and stops on cancel')

    console.log('All MCP library checks passed.')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
