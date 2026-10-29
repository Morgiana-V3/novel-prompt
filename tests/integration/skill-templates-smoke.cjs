const { app } = require('electron')
const { join } = require('node:path')
const { readFileSync, mkdirSync, cpSync } = require('node:fs')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-skill-templates-')
const root = join(__dirname, '../..')
app.setPath('userData', profile)
app.getAppPath = () => root
require('../support/register-typescript.cjs')
const skills = require('../../src/main/modules/skills/service.ts')
const { missingSkillLinks } = require('../../src/shared/skills/references.ts')
const { renderDocumentMarkdown } = require('../../src/renderer/src/shared/lib/markdown.ts')
const { skillTools } = require('../../src/main/adapters/mcp/tools/skills.ts')
const { contextSkills } = require('../../src/main/adapters/mcp/skills-cache.ts')
const { saveSettings } = require('../../src/main/modules/settings/service.ts')
const { bundledUserSkillPath } = require('../../src/main/infrastructure/paths.ts')
const baseline = require('../fixtures/manga-template-baseline.json')
const merge = require('../fixtures/manga-template-merge.json')
const { checkSkillDocuments } = require('../support/skill-document-checks.cjs')
const hash = (text) => createHash('sha256').update(text).digest('hex')

app.whenReady().then(async () => {
  try {
    const before = skills.getConfig()
    const beforeContext = skills.composeSkills('workspace', 'v5').text
    const id = 'nai-manga-prompt-design'
    const doc = skills.getSkill(id)
    assert.equal(doc.builtin, false)
    assert.equal(doc.format, 'directory')
    assert.equal(doc.resources.length, 0)
    assert.equal(before.find((s) => s.id === id).enabled, false)
    assert.equal(before.filter((s) => s.id === id).length, 1)
    assert.equal(skills.getSkill('template:../../secrets'), null)
    assert.equal(skills.composeSkills('workspace', 'v5').text, beforeContext)
    assert.deepEqual(missingSkillLinks(doc.content, doc.resources), [])

    const files = new Map([
      ['SKILL.md', doc.content],
      ...doc.resources.map((resource) => [resource.path, resource.content]),
    ])
    checkSkillDocuments(files, renderDocumentMarkdown)
    const corpus = [...files.values()].join('\n')
    const blocks = new Set(
      [...corpus.matchAll(/```[^\n]*\n[\s\S]*?\n```/g)].map((match) => hash(match[0])),
    )
    for (const code of baseline.codeBlockHashes) {
      const revision = merge.codeRevisions.find((item) => item.before === code)
      assert(
        blocks.has(code) || (revision?.reason && blocks.has(revision.after)),
        'Lost original example',
      )
    }
    assert.equal(
      [...corpus.matchAll(/```[^\n]*\n[\s\S]*?\n```/g)].length,
      baseline.codeBlockHashes.length,
    )
    const paragraphs = new Set(corpus.split(/\n\s*\n/).map((part) => hash(part.trim())))
    for (const expected of Object.values(merge.passages).flat()) {
      const revision = merge.revisions.find((item) => item.before === expected)
      assert(
        paragraphs.has(expected) ||
          (revision?.reason &&
            revision.after.length &&
            revision.after.every((part) => paragraphs.has(part))),
        `Lost original paragraph ${expected}`,
      )
    }
    for (const heading of baseline.techniqueHeadings) {
      assert(corpus.includes(`### ${heading}\n`))
    }
    const completeExample = [...corpus.matchAll(/```text\n([\s\S]*?)\n```/g)]
      .map((match) => match[1])
      .find((text) => text.startsWith('[Prompt]') && text.includes('Text: 坐这里。'))
    assert(completeExample)
    const fields = [...completeExample.matchAll(/^\[([^\]]+)\]\n([\s\S]*?)(?=\n\[|$)/gm)]
    const appearances = fields.filter((field) => /^Character \d+ @/.test(field[1]))
    assert.equal(appearances.length, 4)
    const positions = appearances.map((field) => field[1].split('@ ')[1].split(',').map(Number))
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    )
    assert(appearances[1][2].includes('glasses'))
    assert(appearances[1][2].trim().endsWith('Text: 坐这里。'))
    assert(appearances[3][2].includes('bob cut'))
    assert(appearances[3][2].trim().endsWith('Text: 好。'))
    assert(fields.every((field) => !field[2].includes('[Character')))
    assert(!corpus.includes('已由用户采纳为默认'))
    assert(!corpus.includes('用户已确认采用的默认漫画画风'))

    const tools = skillTools()
    assert(!tools.some((tool) => tool.name === 'list_skill_templates'))
    const catalog = await tools.find((tool) => tool.name === 'list_skills').run({})
    assert(JSON.stringify(catalog).includes(id))
    const read = tools.find((tool) => tool.name === 'get_skill')
    const reference = await read.run({ id })
    assert(JSON.stringify(reference).includes('人物互动、手别与动作结果'))

    const copy = skills.duplicateSkill(id)
    assert.equal(copy.builtin, false)
    assert.deepEqual(copy.resources, doc.resources)
    assert.equal(skills.getConfig().find((s) => s.id === copy.id).enabled, false)
    assert.equal(skills.composeSkills('workspace', 'v5').text, beforeContext)
    skills.setConfig(skills.getConfig().map((s) => ({ id: s.id, enabled: s.id === copy.id })))
    const composed = skills.composeSkills('workspace', 'v5')
    const entrySection = composed.snapshot.sections.find((s) => s.id === copy.id)
    const originalTotal =
      composed.text.length - (entrySection.end - entrySection.start) + baseline.originalBodyChars
    assert(
      composed.text.includes(doc.content),
      'All manga rules and examples must be delivered initially',
    )
    assert.equal(composed.snapshot.sections.filter((s) => s.resourcePath).length, 0)
    const initial = contextSkills(composed.snapshot, { skills_task: 'prompt' })
    assert(initial.selectedIds.includes(copy.id))
    assert(initial.sections.find((s) => s.id === copy.id).text.includes(doc.content))
    assert.equal(initial.missingRequiredIds.length, 0)

    const exportRoot = join(profile, 'export')
    mkdirSync(exportRoot)
    const exported = skills.exportSkillDirectory(id, exportRoot)
    assert.deepEqual(skills.previewSkillDirectory(exported).input.resources, doc.resources)
    skills.updateSkill(copy.id, { content: '# My scene', resources: [] })
    assert.deepEqual(skills.getSkill(id), doc)
    skills.deleteSkill(copy.id)

    // Exercise the installed-app resource location, with no writes to an installed profile.
    const builder = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build
    assert(
      builder.extraResources.some(
        (r) => r.from === 'skill-templates' && r.to === 'skill-templates',
      ),
    )
    const packaged = Object.getOwnPropertyDescriptor(app, 'isPackaged')
    const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const packagedRoot = join(profile, 'packaged')
    cpSync(join(root, 'skill-templates'), join(packagedRoot, 'skill-templates'), {
      recursive: true,
    })
    try {
      Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: packagedRoot })
      assert.equal(skills.getSkill(id).content, doc.content)
      assert.deepEqual(skills.getSkill(id).resources, doc.resources)
      assert(bundledUserSkillPath(id).startsWith(packagedRoot))
      assert(
        readFileSync(bundledUserSkillPath(id), 'utf8').replace(/\r\n/g, '\n').includes(doc.content),
      )
      assert(!skills.skillFilePath(id).startsWith(packagedRoot))
    } finally {
      Object.defineProperty(app, 'isPackaged', packaged)
      Object.defineProperty(process, 'resourcesPath', resources)
    }
    const keptCopy = skills.duplicateSkill(id)
    skills.setConfig(before.map(({ id, enabled }) => ({ id, enabled })))
    skills.updateSkill(id, { content: '# Personal manga rules' })
    assert.equal(skills.getSkill(id).content, '# Personal manga rules')
    assert.equal(skills.getConfig().find((s) => s.id === id).enabled, false)
    const beforeDelete = skills.composeSkills('workspace', 'v5')
    skills.deleteSkill(id)
    assert(!skills.getConfig().some((s) => s.id === id))
    assert.equal(skills.getSkill(id), null)
    assert.throws(() => skills.duplicateSkill(id), /找不到/)
    assert.equal(skills.getSkill(keptCopy.id).content, doc.content)
    const afterDelete = skills.composeSkills('workspace', 'v5')
    assert.deepEqual(
      afterDelete,
      beforeDelete,
      'Deleting a template must not change active rules or snapshots',
    )
    assert.deepEqual(
      contextSkills(afterDelete.snapshot, { skills_task: 'all', skills_mode: 'full' }),
      contextSkills(beforeDelete.snapshot, { skills_task: 'all', skills_mode: 'full' }),
    )
    const savedSettings = JSON.parse(readFileSync(join(profile, 'data/settings.json'), 'utf8'))
    assert(savedSettings.initializedUserSkills.includes(id))
    // An old deletion is a lasting choice, even before the new migration has run.
    saveSettings({ initializedUserSkills: [], deletedSkillTemplates: [`template:${id}`] })
    assert(!skills.getConfig().some((s) => s.id === id))
    // Existing personal copies retain their text, enabled state and position.
    skills.updateSkill(keptCopy.id, { content: '# Existing custom manga' })
    skills.setConfig([{ id: keptCopy.id, enabled: true }])
    const configBeforeMigration = skills.getConfig()
    saveSettings({ initializedUserSkills: [], deletedSkillTemplates: [] })
    assert.deepEqual(skills.getConfig(), configBeforeMigration)
    assert.equal(skills.getSkill(keptCopy.id).content, '# Existing custom manga')
    console.log(
      JSON.stringify({
        entryChars: doc.chars,
        firstLoadChars: composed.text.length,
        originalTotal,
        references: doc.resources.length,
      }),
    )
    console.log(`PASS skill templates; artifacts: ${profile}`)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
