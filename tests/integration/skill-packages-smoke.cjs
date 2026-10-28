const { temporaryProfile } = require('../support/fixtures.cjs')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  renameSync,
} = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const profile = temporaryProfile('np-skill-packages-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const skills = require('../../src/main/modules/skills/service.ts')
const { contextSkills } = require('../../src/main/adapters/mcp/skills-cache.ts')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
const { missingSkillLinks } = require('../../src/shared/skills/references.ts')
const provider = require('../../src/main/providers/chat/client.ts')
const { chat } = require('../../src/main/modules/prompts/chat.ts')
const source = join(profile, 'source')
mkdirSync(join(source, 'references'), { recursive: true })
mkdirSync(join(source, 'scripts'))
writeFileSync(
  join(source, 'SKILL.md'),
  '---\nname: 目录测试\ndescription: >\n  第一行\n  第二行\nscope: all\n---\n# 入口\n遇到角色问题读取 [角色](references/角色.md)。',
)
writeFileSync(join(source, 'references/角色.md'), '# 角色参考\nREFERENCE_BODY_V1')
writeFileSync(join(source, 'scripts/run.py'), 'raise Exception("must not execute")')
writeFileSync(
  join(source, 'example.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kcAAAAAASUVORK5CYII=',
    'base64',
  ),
)
let win
app.whenReady().then(async () => {
  try {
    saveSettings({ apiKey: 'fixture' })
    const preview = skills.previewSkillDirectory(source)
    assert.equal(preview.input.description, '第一行 第二行')
    assert.equal(preview.input.resources.length, 2)
    assert(preview.warnings.some((warning) => warning.includes('scripts')))
    assert.deepEqual(missingSkillLinks(preview.input.content, preview.input.resources), [])
    const singleFile = join(profile, 'single.md')
    writeFileSync(singleFile, '# KEEP_SINGLE')
    const single = skills.importSkillFile(singleFile)
    const original = skills.createSkill(preview.input)
    const second = skills.createSkill(preview.input)
    assert.notEqual(original.id, second.id)
    skills.setConfig([
      { id: original.id, enabled: true },
      { id: single.id, enabled: false },
      ...skills
        .getConfig()
        .filter((skill) => ![original.id, single.id].includes(skill.id))
        .map((skill) => ({ id: skill.id, enabled: false })),
    ])
    const composed = skills.composeSkills('workspace', 'v5')
    assert(!composed.text.includes('REFERENCE_BODY_V1'))
    assert(composed.snapshot.text.includes('REFERENCE_BODY_V1'))
    const referenceId = `${original.id}/references/角色.md`
    const initial = contextSkills(composed.snapshot, { skills_task: 'inpaint' })
    assert(!initial.sections.some((section) => section.id === referenceId))
    assert(!initial.requiredIds.includes(referenceId))
    const loaded = contextSkills(composed.snapshot, {
      skills_task: 'inpaint',
      skills_ids: [referenceId],
    })
    assert(
      loaded.sections
        .find((section) => section.id === referenceId)
        .text.includes('REFERENCE_BODY_V1'),
    )
    assert(
      contextSkills(composed.snapshot, { skills_task: 'all' }).sections.some(
        (section) => section.id === referenceId,
      ),
    )
    assert.throws(
      () =>
        skills.updateSkill(original.id, {
          resources: [{ path: '../escape.md', kind: 'markdown', content: 'bad' }],
        }),
      /路径/,
    )
    assert.equal(skills.getSkill(original.id).resources.length, 2)
    skills.updateSkill(original.id, { description: 'updated metadata' })
    assert.equal(skills.getSkill(original.id).resources.length, 2)
    const packagePath = join(profile, 'skills/user', original.id)
    renameSync(packagePath, `${packagePath}.backup-11111111-1111-1111-1111-111111111111`)
    assert.equal(skills.getSkill(original.id).resources.length, 2)
    assert(existsSync(packagePath))
    const copy = skills.duplicateSkill(original.id)
    assert.deepEqual(copy.resources, original.resources)
    assert.equal(skills.getConfig().find((skill) => skill.id === copy.id).enabled, false)
    const exported = skills.exportSkillDirectory(copy.id, profile)
    assert(existsSync(join(exported, 'references/角色.md')))
    assert.throws(() => skills.exportSkillDirectory(copy.id, profile), /已存在/)
    assert.equal(
      readFileSync(join(source, 'references/角色.md'), 'utf8'),
      '# 角色参考\nREFERENCE_BODY_V1',
    )
    skills.deleteSkill(copy.id)
    assert.equal(skills.getSkill(copy.id), null)
    assert.equal(skills.getSkill(single.id).content, '# KEEP_SINGLE')
    assert(missingSkillLinks('[missing](references/missing.md)', []).length)
    const linked = join(profile, 'linked')
    symlinkSync(source, linked, 'junction')
    assert.throws(() => skills.previewSkillDirectory(linked), /链接/)
    console.log('PASS directory import, isolation, copy, export, validation, and legacy data')

    let requests = 0
    provider.requestChat = async (messages, _settings, options) => {
      requests++
      assert(options.tools.some((tool) => tool.function.name === 'read_skill_reference'))
      if (requests === 1) {
        return {
          role: 'assistant',
          content: null,
          reasoning_content: 'preserve',
          tool_calls: [
            {
              id: 'read-1',
              type: 'function',
              function: {
                name: 'read_skill_reference',
                arguments: JSON.stringify({ id: referenceId }),
              },
            },
          ],
        }
      }
      assert(
        messages.some(
          (message) => message.role === 'tool' && message.content.includes('REFERENCE_BODY_V1'),
        ),
      )
      return { role: 'assistant', content: '{"ok":true}' }
    }
    skills.updateSkill(original.id, {
      resources: [
        { path: 'references/角色.md', kind: 'markdown', content: 'CHANGED_AFTER_SNAPSHOT' },
      ],
    })
    const messages = [
      { role: 'system', content: composed.text },
      { role: 'user', content: '角色问题' },
    ]
    assert.equal(
      (await chat(messages, { skillSnapshot: composed.snapshot })).content,
      '{"ok":true}',
    )
    assert.equal(requests, 2)
    assert.equal(messages[2].reasoning_content, 'preserve')
    provider.requestChat = async () => ({
      role: 'assistant',
      content: null,
      reasoning_content: 'mixed',
      tool_calls: [
        {
          id: 'read-mixed',
          type: 'function',
          function: {
            name: 'read_skill_reference',
            arguments: JSON.stringify({ id: referenceId }),
          },
        },
        { id: 'tag-mixed', type: 'function', function: { name: 'search_tags', arguments: '{}' } },
      ],
    })
    const mixedMessages = [{ role: 'user', content: 'mixed' }]
    const mixed = await chat(mixedMessages, { skillSnapshot: composed.snapshot })
    assert.equal(mixed.tool_calls[0].id, 'tag-mixed')
    assert.equal(mixedMessages[1].tool_calls.length, 1)
    assert.equal(mixedMessages[2].tool_call_id, 'read-mixed')
    const cancelled = new AbortController()
    cancelled.abort()
    await assert.rejects(chat([], { skillSnapshot: composed.snapshot, signal: cancelled.signal }))
    skills.deleteSkill(original.id)
    assert(
      contextSkills(composed.snapshot, { skills_ids: [referenceId] }).sections.some((section) =>
        section.text.includes('REFERENCE_BODY_V1'),
      ),
    )
    console.log(
      'PASS lazy reads use frozen references after live edits/deletion; no real model calls',
    )

    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: {
        preload: join(__dirname, '../../out/preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    require('../../src/main/adapters/ipc/skills.ts').registerSkillsIpc({ getWindow: () => win })
    const handlers = {
      'settings:get': () => getSettings(),
      'settings:save': (_event, patch) => saveSettings(patch),
      'agents:list': () => [],
      'tasks:list': () => ({ revision: 0, tasks: [] }),
      'images:cleanup-status': () => ({ pending: 0, message: '' }),
      'window:dark-titlebar': () => {},
      'mcp:info': () => null,
      'update:check': () => null,
      'update:state': () => null,
      'db:status': () => ({
        loaded: true,
        tagCount: 0,
        aliasCount: 0,
        zhCount: 0,
        implicationCount: 0,
      }),
      'nai:list': () => [],
      'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
      'pages:list': () => [],
      'prompt:analyze': () => ({
        tokens: [],
        stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
      }),
    }
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, handler)
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    const js = (code) => win.webContents.executeJavaScript(code, true)
    const wait = async (code) => {
      for (let index = 0; index < 150; index++) {
        if (await js(code)) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error(`UI timeout: ${code}`)
    }
    const click = (text) =>
      js(
        `(() => { const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button'); button.click() })()`,
      )
    win.showInactive()
    await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
    await wait(
      "[...document.querySelectorAll('button')].some(element => element.textContent.trim() === '设置 / 数据')",
    )
    await click('设置 / 数据')
    await wait("!!document.querySelector('#skill-manager')")
    await click('导入 Skill 文件夹')
    await wait("!!document.querySelector('.skill-import-dialog')")
    assert(
      (await js("document.querySelector('.skill-import-dialog').textContent")).includes('scripts'),
    )
    await new Promise((resolve) => setTimeout(resolve, 800))
    writeFileSync(
      join(profile, 'import-preview.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await click('确认导入')
    await wait("!!document.querySelector('.sk-dialog')")
    await click('参考资料（2）')
    await js(
      "(() => { const select = document.querySelector('.sk-dialog select'); select.value = 'references/角色.md'; select.dispatchEvent(new Event('change', { bubbles: true })); })()",
    )
    await wait("!!document.querySelector('.skill-resource-text')")
    await js(
      "(() => { const textarea = document.querySelector('.skill-resource-text'); textarea.value = '# 编辑后的参考'; textarea.dispatchEvent(new Event('input', { bubbles: true })); })()",
    )
    await new Promise((resolve) => setTimeout(resolve, 800))
    writeFileSync(
      join(profile, 'resource-editor.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await js("document.querySelector('.sk-foot .btn.primary').click()")
    await wait("!document.querySelector('.sk-dialog')")
    const saved = skills.getConfig().find((skill) => skill.name === '目录测试' && skill.enabled)
    assert(
      skills.getSkill(saved.id).resources.some((resource) => resource.content === '# 编辑后的参考'),
    )
    console.log(
      `PASS real UI folder preview, import, reference editing and save; screenshots: ${profile}`,
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
