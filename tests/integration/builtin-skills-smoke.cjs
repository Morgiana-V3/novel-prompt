const { app } = require('electron')
const { join } = require('node:path')
const { readFileSync, writeFileSync, mkdirSync, cpSync } = require('node:fs')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-builtin-skills-')
const root = join(__dirname, '../..')
app.setPath('userData', profile)
app.getAppPath = () => root
require('../support/register-typescript.cjs')
const skills = require('../../src/main/modules/skills/service.ts')
const paths = require('../../src/main/infrastructure/paths.ts')
const { saveSettings } = require('../../src/main/modules/settings/service.ts')
const { missingSkillLinks } = require('../../src/shared/skills/references.ts')
const { contextSkills } = require('../../src/main/adapters/mcp/skills-cache.ts')
const { skillTools } = require('../../src/main/adapters/mcp/tools/skills.ts')
const { createPromptGuideTool } = require('../../src/main/adapters/mcp/tools/prompts.ts')
const provider = require('../../src/main/providers/chat/client.ts')
const { chat } = require('../../src/main/modules/prompts/chat.ts')
const baseline = require('../fixtures/builtin-skills-baseline.json')
const contentBaseline = require('../fixtures/builtin-skills-content.json')
const precisionRevisions = require('../fixtures/builtin-skills-precision-revisions.json')
const mergeBaseline = require('../fixtures/builtin-skills-merge-baseline.json')
const mergeRevisions = require('../fixtures/builtin-skills-merge-revisions.json')
const { checkSkillDocuments } = require('../support/skill-document-checks.cjs')
const { renderDocumentMarkdown } = require('../../src/renderer/src/shared/lib/markdown.ts')
const names = {
  'builtin:prompt': 'nai-prompt',
  'builtin:preview': 'nai-preview',
  'builtin:inpaint': 'nai-inpaint',
}
const hash = (text) => createHash('sha256').update(text).digest('hex')
const paragraphs = (documents) =>
  new Set(documents.flatMap((text) => text.split(/\n\s*\n/).map((part) => hash(part.trim()))))

// Follow documented revisions without replacing either historical or pre-merge baselines.
function preserved(expected, actual, revisions, seen = new Set()) {
  if (actual.has(expected)) {
    return true
  }
  if (seen.has(expected)) {
    return false
  }
  const nextSeen = new Set([...seen, expected])
  return revisions.some(
    (item) =>
      item.before.includes(expected) &&
      item.reason.trim() &&
      item.after.length > 0 &&
      item.after.every((replacement) => preserved(replacement, actual, revisions, nextSeen)),
  )
}

function assertPreserved(name, expected, documents) {
  const actual = paragraphs(documents)
  const revisions = [...(precisionRevisions[name] ?? []), ...(mergeRevisions[name] ?? [])]
  for (const paragraph of expected) {
    assert(
      preserved(paragraph, actual, revisions),
      `${name}: lost preserved paragraph ${paragraph}`,
    )
  }
}

app.whenReady().then(async () => {
  try {
    const config = [
      { id: 'builtin:preview', enabled: false },
      { id: 'builtin:prompt', enabled: true },
      { id: 'builtin:inpaint', enabled: true },
    ]
    saveSettings({ skillsMigrated: true, skills: config, apiKey: 'fixture' })
    assert.deepEqual(
      skills.getConfig().map(({ id, enabled }) => ({ id, enabled })),
      config,
    )
    for (const [id, name] of Object.entries(names)) {
      const doc = skills.getSkill(id)
      assert.equal(doc.format, 'directory')
      assert.equal(
        doc.scope,
        {
          'builtin:prompt': 'optimize',
          'builtin:preview': 'preview',
          'builtin:inpaint': 'inpaint',
        }[id],
      )
      assert.equal(doc.model, 'all')
      assert.ok(doc.name.startsWith('内置 · '))
      assert.deepEqual(
        doc.resources.map((resource) => resource.path),
        id === 'builtin:prompt' ? ['references/examples.md'] : [],
      )
      assert.deepEqual(missingSkillLinks(doc.content, doc.resources), [])
      // Preserve rule paragraphs while allowing peer topics to be regrouped.
      const documents = [doc.content, ...doc.resources.map((resource) => resource.content)]
      checkSkillDocuments(
        new Map([
          ['SKILL.md', doc.content],
          ...doc.resources.map((resource) => [resource.path, resource.content]),
        ]),
        renderDocumentMarkdown,
      )
      assertPreserved(name, contentBaseline.passages[name], documents)
      assertPreserved(name, Object.values(mergeBaseline.passages[name]).flat(), documents)
      // Every former rule reference is delivered in the entry, not merely stored in the package.
      const required = Object.entries(mergeBaseline.passages[name])
        .filter(([path]) => name !== 'nai-prompt' || !path.endsWith('/references/examples.md'))
        .flatMap(([, hashes]) => hashes)
      assertPreserved(name, required, [doc.content])
      const blocks = documents.flatMap((text) =>
        [...text.matchAll(/^\s*```[^\n]*\n[\s\S]*?^\s*```/gm)].map((match) =>
          hash(match[0].trim()),
        ),
      )
      assert.deepEqual(blocks.sort(), [...mergeBaseline.codeBlocks[name]].sort())
      for (const text of documents) {
        assert(!/^#{1,6} \d+(?:\.\d+)*[. ]/m.test(text), 'Peer headings must not imply sequence')
        assert(!/第\s*[\d.]+(?:[、~～–-][\d.]+)*\s*节/.test(text), 'Use topic titles in citations')
        let heading = ''
        let inCode = false
        for (const line of text.split('\n')) {
          if (line.startsWith(String.fromCharCode(96).repeat(3))) {
            inCode = !inCode
          }
          if (!inCode && line.startsWith('## ')) {
            heading = line.slice(3)
          }
          if (!inCode && /^\s*\d+\. /.test(line)) {
            assert(
              heading === '编排顺序' || heading === '执行流程',
              'Numbered lists are reserved for explicit execution order',
            )
          }
        }
      }
      assert.throws(() => skills.updateSkill(id, { content: 'overwrite' }), /内置/)
      const copy = skills.duplicateSkill(id)
      assert.deepEqual(copy.resources, doc.resources)
      assert.equal(skills.getConfig().find((s) => s.id === copy.id).enabled, false)
      const exportRoot = join(profile, name)
      mkdirSync(exportRoot)
      const exported = skills.exportSkillDirectory(copy.id, exportRoot)
      assert.ok(readFileSync(join(exported, 'SKILL.md'), 'utf8').includes(doc.content))
      for (const resource of doc.resources) {
        assert.equal(readFileSync(join(exported, resource.path), 'utf8'), resource.content)
      }
      skills.deleteSkill(copy.id)
    }
    for (const name of ['nai-prompt', 'nai-preview']) {
      assert(paths.KNOWN_DEFAULTS[`${name}.md`].includes(baseline[name].fingerprint))
    }
    // Simulate installation resources without touching the installed app or user data.
    const packaged = Object.getOwnPropertyDescriptor(app, 'isPackaged')
    const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const packagedRoot = join(profile, 'packaged')
    cpSync(join(root, 'skills'), join(packagedRoot, 'skills'), { recursive: true })
    try {
      Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: packagedRoot })
      for (const id of Object.keys(names)) {
        assert.equal(skills.getSkill(id).format, 'directory')
        assert(paths.bundledSkillPath(`${names[id]}.md`).startsWith(packagedRoot))
      }
    } finally {
      Object.defineProperty(app, 'isPackaged', packaged)
      Object.defineProperty(process, 'resourcesPath', resources)
    }
    skills.setConfig(config.map((s) => ({ ...s, enabled: true })))
    const reports = []
    for (const feature of ['optimize', 'preview', 'inpaint', 'workspace']) {
      const composed = skills.composeSkills(feature, 'v5')
      const entries = composed.snapshot.sections.filter(
        (s) => s.scope !== 'core' && !s.resourcePath,
      )
      const oldChars =
        composed.text.length -
        entries.reduce((sum, s) => sum + s.end - s.start, 0) +
        entries.reduce((sum, s) => sum + baseline[names[s.id]].chars, 0)
      // Size is diagnostic. Coverage and correctness must not be constrained by a savings quota.
      reports.push({
        feature,
        oldChars,
        firstChars: composed.text.length,
        reduction: `${((1 - composed.text.length / oldChars) * 100).toFixed(1)}%`,
      })
      assert.equal(composed.text, composed.snapshot.text.slice(0, composed.text.length))
      assert.equal(
        composed.snapshot.sections.some((s) => s.resourcePath),
        feature === 'optimize' || feature === 'workspace',
      )
      for (const entry of entries) {
        const name = names[entry.id]
        const required = Object.entries(mergeBaseline.passages[name])
          .filter(([path]) => name !== 'nai-prompt' || !path.endsWith('/references/examples.md'))
          .flatMap(([, hashes]) => hashes)
        assertPreserved(name, required, [composed.text.slice(entry.start, entry.end)])
      }
    }
    const preview = skills.composeSkills('preview', 'v5')
    assert.throws(
      () =>
        checkSkillDocuments(new Map([['SKILL.md', '见参考资料 8.3 节']]), renderDocumentMarkdown),
      /stale numbered/,
    )
    assert.throws(
      () =>
        checkSkillDocuments(
          new Map([
            ['SKILL.md', '[规则](references/rule.md#旧标题)'],
            ['references/rule.md', '# 新标题'],
          ]),
          renderDocumentMarkdown,
        ),
      /missing/,
    )
    assert.ok(preview.text.includes('### 主提示词与角色提示词'))
    assert.ok(preview.text.includes('### 正负面冲突'))
    const inpaint = skills.composeSkills('inpaint', 'v5')
    assert.ok(inpaint.text.includes('### 保留内容与相邻对象'))
    assert.ok(inpaint.text.includes('### 画面文字'))
    assert.deepEqual(
      inpaint.snapshot.sections
        .filter((section) => section.resourcePath)
        .map((section) => section.resourcePath),
      [],
    )
    const workspace = skills.composeSkills('workspace', 'v5')
    const selected = contextSkills(workspace.snapshot, { skills_task: 'prompt' })
    assert(
      selected.sections.every(
        (s) => !workspace.snapshot.sections.find((section) => section.id === s.id).resourcePath,
      ),
    )
    assert(selected.sections.find((s) => s.id === 'builtin:prompt').text.includes('source#'))
    const resourceId = 'builtin:prompt/references/examples.md'
    const loaded = contextSkills(workspace.snapshot, {
      skills_task: 'prompt',
      skills_ids: [resourceId],
    })
    assert(loaded.sections.find((s) => s.id === resourceId).text.includes('source#'))
    assert.equal(
      contextSkills(workspace.snapshot, { skills_task: 'all' }).sections.length,
      workspace.snapshot.sections.length,
    )
    const getSkill = skillTools().find((tool) => tool.name === 'get_skill')
    const metadata = JSON.parse(await getSkill.run({ id: 'builtin:prompt' }))
    assert(metadata.resources.every((r) => !Object.hasOwn(r, 'content')))
    assert(
      JSON.parse(
        await getSkill.run({ id: 'builtin:prompt', resource: 'references/examples.md' }),
      ).content.includes('source#'),
    )
    const guide = await createPromptGuideTool().run({ version: 'v5' })
    assert(guide.includes(resourceId))
    assert(!guide.includes('两人互动示例'))
    assertPreserved(
      'nai-prompt',
      Object.entries(mergeBaseline.passages['nai-prompt'])
        .filter(([path]) => !path.endsWith('/references/examples.md'))
        .flatMap(([, hashes]) => hashes),
      [JSON.parse(await getSkill.run({ id: 'builtin:prompt' })).content],
    )
    const entry = skills.getSkill('builtin:prompt').content
    const paragraph = entry.split(/\n\s*\n/).find((part) => part.startsWith('**字段底线**'))
    assert.throws(
      () => assertPreserved('nai-prompt', [hash(paragraph.trim())], [entry.replace(paragraph, '')]),
      /lost preserved paragraph/,
    )

    // Fixed scenario reads validate delivery/cost, not a real model's routing or generation quality.
    const scenarios = [
      {
        name: '普通单人提示词与负面检查',
        feature: 'optimize',
        refs: [],
      },
      {
        name: '多人漫画与对白',
        feature: 'optimize',
        refs: [],
      },
      { name: '用户索要完整组合范例', feature: 'optimize', refs: ['examples.md'] },
      { name: '简单画面推测（无角色块或负面）', feature: 'preview', refs: [] },
      { name: '角色与负面误伤推测', feature: 'preview', refs: [] },
      { name: '局部改色（非元数据输入）', feature: 'inpaint', refs: [] },
      {
        name: '局部文字与相邻内容保留',
        feature: 'inpaint',
        refs: [],
      },
    ]
    for (const scenario of scenarios) {
      const composed = skills.composeSkills(scenario.feature, 'v5')
      const skillId = composed.skills[0].id
      const sections = scenario.refs.map((file) =>
        composed.snapshot.sections.find((s) => s.id === `${skillId}/references/${file}`),
      )
      assert(sections.every(Boolean))
      let calls = 0
      provider.requestChat = async (messages, _settings, options) => {
        calls++
        assert.equal(
          !!options.tools?.some((tool) => tool.function.name === 'read_skill_reference'),
          scenario.feature === 'optimize',
        )
        if (calls === 1 && sections.length) {
          assert.equal(messages.length, 2)
          return {
            role: 'assistant',
            content: null,
            tool_calls: sections.map((s, index) => ({
              id: `read-${index}`,
              type: 'function',
              function: { name: 'read_skill_reference', arguments: JSON.stringify({ id: s.id }) },
            })),
          }
        }
        const delivered = messages.filter((m) => m.role === 'tool')
        assert.deepEqual(
          delivered.map((m) => m.content),
          sections.map((s) => composed.snapshot.text.slice(s.start, s.end)),
        )
        return { role: 'assistant', content: '{"verified":true}' }
      }
      const messages = [
        { role: 'system', content: composed.text },
        { role: 'user', content: scenario.name },
      ]
      await chat(messages, { skillSnapshot: composed.snapshot })
      const readChars = sections.reduce((sum, s) => sum + s.end - s.start, 0)
      const oldChars = reports.find((report) => report.feature === scenario.feature).oldChars
      Object.assign(scenario, {
        oldChars,
        firstChars: composed.text.length,
        readChars,
        totalChars: composed.text.length + readChars,
      })
    }
    // Existing personal files and disabled built-ins retain their state across the migration.
    const personal = skills.createSkill(
      { name: '个人规则', content: '# PERSONAL_RULES' },
      { enabled: false },
    )
    skills.setConfig([{ id: 'builtin:prompt', enabled: false }])
    assert.equal(skills.getSkill(personal.id).content, '# PERSONAL_RULES')
    assert.equal(skills.getConfig().find((s) => s.id === personal.id).enabled, false)
    assert(
      !skills
        .composeSkills('optimize', 'v5')
        .snapshot.sections.some((s) => s.id.startsWith('builtin:prompt')),
    )
    mkdirSync(join(profile, 'reports'), { recursive: true })
    writeFileSync(
      join(profile, 'reports/context-size.json'),
      JSON.stringify(
        {
          unit: 'UTF-16 characters; same core/wrappers; excludes tool envelopes and application contracts',
          reports,
          scenarios,
        },
        null,
        2,
      ),
    )
    console.log(JSON.stringify({ reports, scenarios }, null, 2))
    console.log(
      `PASS built-in rule preservation, complete first delivery, IDs/config, copy/export, packaged paths and optional-example reads. Report: ${profile}`,
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
