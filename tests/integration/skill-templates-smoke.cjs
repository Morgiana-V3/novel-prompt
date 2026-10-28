const { app } = require('electron')
const { join, posix } = require('node:path')
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
const baseline = require('../fixtures/manga-template-baseline.json')
const hash = (text) => createHash('sha256').update(text).digest('hex')

app.whenReady().then(async () => {
  try {
    const before = skills.getConfig()
    const beforeContext = skills.composeSkills('workspace', 'v5').text
    const templates = skills.listSkillTemplates()
    assert.equal(templates.length, 1)
    const id = 'template:nai-manga-prompt-design'
    const doc = skills.getSkill(id)
    assert.equal(doc.source, 'template')
    assert.equal(doc.builtin, false)
    assert.equal(doc.format, 'directory')
    assert.equal(doc.resources.length, 13)
    assert(!('resources' in templates[0]))
    assert.equal(skills.getSkill('template:../../secrets'), null)
    assert.deepEqual(skills.setConfig([{ id, enabled: true }]), before)
    assert.equal(skills.composeSkills('workspace', 'v5').text, beforeContext)
    assert.throws(() => skills.updateSkill(id, { content: 'overwrite' }), /只读/)
    assert.deepEqual(missingSkillLinks(doc.content, doc.resources), [])

    const files = new Map([
      ['SKILL.md', doc.content],
      ...doc.resources.map((resource) => [resource.path, resource.content]),
    ])
    // Render actual Markdown so example-code paths are not mistaken for real links.
    const rendered = new Map(
      [...files].map(([path, content]) => [
        path,
        renderDocumentMarkdown(content, { localLinks: true }),
      ]),
    )
    for (const [path, html] of rendered) {
      for (const match of html.matchAll(/<a href="([^"]+)"/g)) {
        const href = decodeURIComponent(match[1])
        if (/^[a-z]+:/i.test(href)) {
          continue
        }
        const [file, anchor] = href.split('#')
        const target = file ? posix.normalize(posix.join(posix.dirname(path), file)) : path
        assert(files.has(target), `${path}: missing ${href}`)
        if (anchor) {
          assert(rendered.get(target).includes(`id="${anchor}"`), `${path}: ${href}`)
        }
      }
    }
    const corpus = [...files.values()].join('\n')
    const blocks = new Set(
      [...corpus.matchAll(/```[^\n]*\n[\s\S]*?\n```/g)].map((match) => hash(match[0])),
    )
    for (const code of baseline.codeBlockHashes) {
      assert(blocks.has(code), 'Lost original example')
    }
    for (const heading of baseline.techniqueHeadings) {
      assert(corpus.includes(`### ${heading}\n`))
    }
    assert(!corpus.includes('已由用户采纳为默认'))
    assert(!corpus.includes('用户已确认采用的默认漫画画风'))

    const tools = skillTools()
    const catalog = await tools.find((tool) => tool.name === 'list_skill_templates').run({})
    assert(JSON.stringify(catalog).includes(id))
    const read = tools.find((tool) => tool.name === 'get_skill')
    const reference = await read.run({ id, resource: 'references/actions.md' })
    assert(JSON.stringify(reference).includes('人物互动与动作结果'))

    const copy = skills.duplicateSkill(id)
    assert.equal(copy.source, undefined)
    assert.equal(copy.builtin, false)
    assert.deepEqual(copy.resources, doc.resources)
    assert.equal(skills.getConfig().find((s) => s.id === copy.id).enabled, false)
    assert.equal(skills.composeSkills('workspace', 'v5').text, beforeContext)
    skills.setConfig(skills.getConfig().map((s) => ({ id: s.id, enabled: s.id === copy.id })))
    const composed = skills.composeSkills('workspace', 'v5')
    const entrySection = composed.snapshot.sections.find((s) => s.id === copy.id)
    const originalTotal =
      composed.text.length - (entrySection.end - entrySection.start) + baseline.originalBodyChars
    assert(composed.text.length < originalTotal * 0.15, 'Entry + manifest must stay small')
    const marker = 'The receiving woman'
    const action = doc.resources.find((r) => r.path === 'references/actions.md')
    assert(action.content.length > 500)
    assert(!composed.text.includes(action.content))
    const resourceId = `${copy.id}/references/actions.md`
    const initial = contextSkills(composed.snapshot, { skills_task: 'prompt' })
    assert(!initial.selectedIds.includes(resourceId))
    const loaded = contextSkills(composed.snapshot, {
      skills_task: 'prompt',
      skills_ids: [resourceId],
    })
    assert.equal(loaded.sections.length, initial.sections.length + 1)
    assert(
      loaded.sections.some((s) => s.id === resourceId && s.text.includes(action.content.trim())),
    )
    assert(!composed.text.includes(marker))

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
      assert(skills.skillFilePath(id).startsWith(packagedRoot))
    } finally {
      Object.defineProperty(app, 'isPackaged', packaged)
      Object.defineProperty(process, 'resourcesPath', resources)
    }
    const keptCopy = skills.duplicateSkill(id)
    skills.deleteSkill(id)
    skills.deleteSkill(id)
    assert.equal(skills.listSkillTemplates().length, 0)
    assert.equal(skills.getSkill(id), null)
    assert.throws(() => skills.duplicateSkill(id), /找不到/)
    assert.equal(skills.getSkill(keptCopy.id).content, doc.content)
    const savedSettings = JSON.parse(readFileSync(join(profile, 'data/settings.json'), 'utf8'))
    assert.deepEqual(savedSettings.deletedSkillTemplates, [id])
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
