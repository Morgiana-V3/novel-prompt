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
const revisions = require('../fixtures/builtin-skills-revisions.json')
const names = {
  'builtin:prompt': 'nai-prompt',
  'builtin:preview': 'nai-preview',
  'builtin:inpaint': 'nai-inpaint',
}
const hash = (text) => createHash('sha256').update(text).digest('hex')

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
      assert.equal(doc.resources.length > 0, id !== 'builtin:preview')
      assert.deepEqual(missingSkillLinks(doc.content, doc.resources), [])
      // Preserve original chapters except explicitly recorded quality corrections.
      const sectionHashes = new Set(
        [doc.content, ...doc.resources.map((r) => r.content)].flatMap((text) =>
          text
            .split(/(?=^#{2,3} \d)/m)
            .slice(1)
            .map((chunk) => hash(chunk.trim())),
        ),
      )
      for (const section of baseline[name].sections) {
        assert(
          sectionHashes.has(revisions[name]?.[section.section]?.hash ?? section.hash),
          `${name} lost or changed original section ${section.section}`,
        )
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
      // Small frequently used rules are eager; only large packages target first-load savings.
      if (feature === 'workspace') {
        assert(composed.text.length < oldChars)
      }
      if (feature === 'optimize') {
        assert(composed.text.length < oldChars * 0.5)
      }
      reports.push({
        feature,
        oldChars,
        firstChars: composed.text.length,
        reduction: `${((1 - composed.text.length / oldChars) * 100).toFixed(1)}%`,
      })
      assert.equal(composed.text, composed.snapshot.text.slice(0, composed.text.length))
      assert.equal(
        composed.snapshot.sections.some((s) => s.resourcePath),
        feature !== 'preview',
      )
    }
    const preview = skills.composeSkills('preview', 'v5')
    assert.ok(preview.text.includes('### 1.3 主提示词与角色提示词'))
    assert.ok(preview.text.includes('### 8.3 正负面冲突'))
    const inpaint = skills.composeSkills('inpaint', 'v5')
    assert.ok(inpaint.text.includes('### 2.2 保留内容与相邻对象'))
    assert.ok(inpaint.text.includes('### 4.3 画面文字'))
    assert.deepEqual(
      inpaint.snapshot.sections
        .filter((section) => section.resourcePath)
        .map((section) => section.resourcePath),
      ['references/examples.md'],
    )
    const workspace = skills.composeSkills('workspace', 'v5')
    const selected = contextSkills(workspace.snapshot, { skills_task: 'prompt' })
    assert(
      selected.sections.every(
        (s) => !workspace.snapshot.sections.find((section) => section.id === s.id).resourcePath,
      ),
    )
    const resourceId = 'builtin:prompt/references/characters.md'
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
        await getSkill.run({ id: 'builtin:prompt', resource: 'references/characters.md' }),
      ).content.includes('source#'),
    )
    const guide = await createPromptGuideTool().run({ version: 'v5' })
    assert(guide.includes(resourceId))
    assert(!guide.includes('例 1：两人互动'))

    // Fixed scenario reads validate delivery/cost, not a real model's routing or generation quality.
    const scenarios = [
      {
        name: '普通单人提示词与负面检查',
        feature: 'optimize',
        refs: ['consistency.md', 'negative.md'],
      },
      {
        name: '多人漫画与对白',
        feature: 'optimize',
        refs: [
          'consistency.md',
          'characters.md',
          'language-text.md',
          'model-tags.md',
          'negative.md',
        ],
      },
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
          scenario.feature !== 'preview',
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
      `PASS built-in package preservation, IDs/config, copy/export, packaged paths, MCP/lazy delivery. Report: ${profile}`,
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
