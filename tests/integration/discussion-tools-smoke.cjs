const { app } = require('electron')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-discussion-tools-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const provider = require('../../src/main/providers/chat/client.ts')
const { chat } = require('../../src/main/modules/prompts/chat.ts')
const { ReadOnlyToolSession } = require('../../src/main/modules/prompts/tool-session.ts')
const optimizer = require('../../src/main/modules/prompts/optimizer.ts')
const skills = require('../../src/main/modules/skills/service.ts')
const { tagStore } = require('../../src/main/modules/tags/store.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
const { discussPage } = require('../../src/main/modules/workspace/discussion.ts')
const { pageLocks } = require('../../src/main/modules/workspace/locks.ts')
const { saveSettings } = require('../../src/main/modules/settings/service.ts')
const call = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})
const reply = (calls) => ({ role: 'assistant', content: null, tool_calls: calls })
const final = {
  role: 'assistant',
  content: JSON.stringify({
    reply: '已整理方案；未查询项不作为已核实依据。',
    understanding: null,
    proposal: null,
  }),
}
const params = {
  width: 832,
  height: 1216,
  qualityTags: false,
  ucPreset: 'none',
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'native',
  seed: null,
  count: 1,
}

app.whenReady().then(async () => {
  try {
    saveSettings({ apiKey: 'fixture' })
    let active = 0
    let peak = 0
    const executor = new ReadOnlyToolSession(
      async (_name, args) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return JSON.stringify(args)
      },
      new Set(['search_tags']),
      12,
    )
    const batch = Array.from({ length: 16 }, (_, i) =>
      call(`c${i}`, 'search_tags', { queries: [String(i % 14)] }),
    )
    const results = await executor.run(batch)
    assert.equal(results.length, batch.length)
    assert.deepEqual(
      results.map((r) => r.tool_call_id),
      batch.map((c) => c.id),
    )
    assert.equal(executor.stats.executed, 12)
    assert.equal(executor.stats.cached, 2)
    assert.equal(executor.stats.limited, 2)
    assert(peak > 1 && peak <= 4)
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(executor.run(batch, aborted.signal))

    // Exercise batching with an explicit user package, independent of built-in rule layout.
    const referenceFixture = skills.createSkill({
      name: '批量读取测试',
      scope: 'all',
      format: 'directory',
      content: '# 测试入口\n[第一篇](references/first.md) / [第二篇](references/second.md)',
      resources: [
        { path: 'references/first.md', kind: 'markdown', content: '# 第一篇\nFIRST_REFERENCE' },
        { path: 'references/second.md', kind: 'markdown', content: '# 第二篇\nSECOND_REFERENCE' },
      ],
    })
    const snapshot = skills.composeSkills('workspace', 'v5').snapshot
    const refs = snapshot.sections.filter((s) => s.resourcePath).slice(0, 2)
    assert.equal(refs.length, 2)
    assert(refs.every((s) => s.skillId === referenceFixture.id))
    let turn = 0
    provider.requestChat = async (messages, _settings, options) => {
      turn++
      if (turn === 1) {
        assert(options.tools.some((t) => t.function.parameters.properties.ids))
        return reply([call('refs', 'read_skill_reference', { ids: refs.map((r) => r.id) })])
      }
      if (turn === 2) {
        assert(
          refs.every((r) => messages.at(-1).content.includes(snapshot.text.slice(r.start, r.end))),
        )
        return reply([call('repeat', 'read_skill_reference', { id: refs[0].id })])
      }
      assert(!options.tools?.some((t) => t.function.name === 'read_skill_reference'))
      assert(messages.some((m) => m.role === 'tool' && m.content.includes('正文已在本轮')))
      return final
    }
    await chat([{ role: 'user', content: '批量读取' }], { skillSnapshot: snapshot })
    assert.equal(turn, 3)

    // A batch above the former 8-call cap must complete, with duplicates executed once.
    tagStore.loaded = true
    let executed = 0
    optimizer.tagTool = async () => {
      executed++
      return 'fixture lookup'
    }
    let modelCalls = 0
    provider.requestChat = async (messages) => {
      modelCalls++
      if (modelCalls === 1) {
        return reply([
          call('reference', 'read_skill_reference', { ids: refs.map((r) => r.id) }),
          ...Array.from({ length: 12 }, (_, i) =>
            call(`tag${i}`, 'search_tags', { queries: [String(i % 10)] }),
          ),
        ])
      }
      const requested = messages.flatMap((m) => m.tool_calls || []).map((c) => c.id)
      const answered = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)
      assert.deepEqual([...requested].sort(), [...answered].sort())
      return final
    }
    let page = await pages.createPage(null, params, 'v5', {
      base: '',
      negative: '',
      characters: [],
    })
    page = await discussPage(page.id, page.revision, '五格战斗漫画方案', null, [])
    assert.equal(page.messages.at(-1).role, 'assistant')
    assert.equal(executed, 10)
    assert.equal(page.messages.at(-1).toolUsage.tagCacheHits, 2)
    assert.equal(page.messages.at(-1).toolUsage.referenceFiles, 2)

    // Six rounds of discovery end in an explicit no-tools synthesis, not a discarded turn.
    modelCalls = 0
    provider.requestChat = async (messages, _settings, options) => {
      modelCalls++
      if (modelCalls <= 6) {
        return reply([call(`round${modelCalls}`, 'search_tags', { queries: [String(modelCalls)] })])
      }
      assert(!options.tools?.length)
      assert(messages.at(-1).content.includes('停止调用工具'))
      return final
    }
    page = await discussPage(page.id, page.revision, '继续核对', null, [])
    assert.equal(modelCalls, 7)
    assert.equal(page.messages.at(-1).role, 'assistant')

    // Total unique-call cap is still enforced, then answered from existing evidence.
    modelCalls = 0
    provider.requestChat = async (_messages, _settings, options) => {
      if (++modelCalls === 1) {
        return reply(
          Array.from({ length: 55 }, (_, i) =>
            call(`limit${i}`, 'search_tags', { queries: [String(i)] }),
          ),
        )
      }
      assert(!options.tools?.length)
      return final
    }
    page = await discussPage(page.id, page.revision, '多个概念', null, [])
    assert.equal(page.messages.at(-1).toolUsage.tagExecuted, 48)
    assert.equal(page.messages.at(-1).toolUsage.tagLimited, 7)

    provider.requestChat = async () =>
      reply([call('cancel', 'search_tags', { queries: ['cancel'] })])
    optimizer.tagTool = async (_name, _args, signal) => {
      pageLocks.get(page.id).abort()
      signal.throwIfAborted()
    }
    await assert.rejects(discussPage(page.id, page.revision, '取消测试', null, []))
    assert(!pageLocks.has(page.id))
    assert(pages.readPage(page.id).messages.at(-1).text.includes('已取消'))
    console.log(
      'PASS batched references, duplicate suppression, concurrency, >8 calls, bounded synthesis and cancellation',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
