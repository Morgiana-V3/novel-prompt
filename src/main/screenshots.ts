import { app, BrowserWindow, nativeImage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { createPage, savePage } from './page-workspaces'
import { imageDir, listImages } from './nai/client'
import { pageChanges, pageContextKey, pageCurrent } from '../shared/page-workspace'
import type { InpaintDraft, NaiGenParams } from '../shared/types'

/** Offline display fixture, using only the repository's own mascot assets. */
async function prepareWorkspaceDemo(): Promise<void> {
  const width = 512, height = 768
  for (const [name, asset] of [['demo-before.png', 'idle'], ['demo-after.png', 'wink']]) {
    const src = PNG.sync.read(nativeImage.createFromPath(resolve(`src/renderer/src/assets/mascot/${asset}.png`)).resize({ height: 650 }).toPNG())
    const canvas = new PNG({ width, height }); canvas.data.fill(255)
    const left = Math.floor((width - src.width) / 2), top = 60
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      if (x + left < 0 || x + left >= width || y + top >= height) continue
      const a = (y * src.width + x) * 4, b = ((y + top) * width + x + left) * 4, alpha = src.data[a + 3] / 255
      for (let c = 0; c < 3; c++) canvas.data[b + c] = Math.round(src.data[a + c] * alpha + 255 * (1 - alpha))
    }
    writeFileSync(join(imageDir(), name), PNG.sync.write(canvas))
  }
  const params: NaiGenParams = { width, height, steps: 23, scale: 5, cfgRescale: 0, seed: 42, count: 1, sampler: 'k_euler_ancestral', noiseSchedule: 'native', qualityTags: false, ucPreset: 'none' }
  const before: InpaintDraft = { base: '1girl, solo, cat ears, white hair, pink eyes, white background, full body, smile', negative: 'lowres, blurry', characters: [] }
  const after = { ...before, base: before.base + ', one eye closed' }
  const w = await createPage('demo-before.png', params, 'v5', before)
  w.title = '角色表情探索 · 演示会话'; w.goal = '保持角色设计，比较不同表情'; w.preserve = '保留发色、服装与整体画风'
  const first = pageCurrent(w), now = Date.now()
  w.versions.push({ id: 'demo-result', parentId: first.id, label: '眨眼表情', image: listImages().find(i => i.name === 'demo-after.png')!, createdAt: now,
    editor: { draft: after, params: { ...params, seed: 43 }, regions: [], strength: 1 },
    generated: { draft: structuredClone(after), params: { ...params, seed: 43 }, execution: { kind: 'generate', regionId: null }, sourceVersionId: first.id } })
  w.currentVersionId = 'demo-result'
  const next = { ...after, base: after.base + ', head tilt' }
  w.messages = [
    { id: 'demo-note', role: 'event', text: '离线演示：图片使用项目内置素材，对话与版本记录为示例，不调用在线模型。', createdAt: now, versionId: first.id },
    { id: 'demo-user', role: 'user', text: '保留目前的眨眼表情，下一版试试轻微歪头。先给我看提示词修改。', createdAt: now, versionId: w.currentVersionId },
    { id: 'demo-ai', role: 'assistant', text: '### 下一步建议\n\n保留当前的**角色设计与眨眼表情**，只增加 `head tilt`。\n\n- 在这条消息下方检查词语变化，再决定是否采纳。\n- 采纳只更新草稿，仍需单独点击生成。\n- 「修改对比」保留每轮图片、提示词和参数。\n\n> 这是界面演示数据，不代表已调用模型。', createdAt: now, versionId: w.currentVersionId,
      proposal: { title: '保留表情，尝试轻微歪头', warning: '', regionId: null, status: 'pending', contextKey: pageContextKey(pageCurrent(w), null, w), before: structuredClone(after), after: next, previousAccepted: null, changes: pageChanges(after, next), execution: { kind: 'generate', regionId: null } } }
  ]
  savePage(w)
}

/**
 * README 截图模式：NovelPrompt --screenshots=<输出目录> [--screenshots-ai]
 *
 * - 使用临时用户目录：不读取你的 NovelAI Token，不改动你的当前提示词和历史
 * - 从真实用户目录只复制 tag 数据（不含 settings.json）；加 --screenshots-ai 时额外复制 DeepSeek 的配置，
 *   真实跑一次 AI 优化和画面推测再截图（会消耗少量额度），否则这两页只截输入状态
 */

const SAMPLE = {
  prompt:
    '2girls, artist:wlop, outdoors, cherry blosoms, falling petals, spring (season), wind, from side, upper body, sunlight, depth of field, very aesthetic, masterpiece, Two girls walking side by side under the cherry trees.',
  negative: 'lowres, bad anatomy, bad hands, worst quality, low quality, jpeg artifacts, blurry, watermark',
  characters: [
    { prompt: 'girl, silver hair, twin tails, red eyes, white dress, smile, mutual#holding hands', negative: 'black hair, glasses', position: 'B3' },
    { prompt: 'girl, black hair, short hair, glasses, school uniform, looking at another, mutual#holding hands', negative: 'silver hair, twintails', position: 'D3' }
  ],
  params: { width: 832, height: 1216, qualityTags: true, ucPreset: 'heavy' },
  history: []
}

/** 截图用的示例用户 Skill，展示多份 Skill 叠加与优先级 */
const SAMPLE_SKILL = `---
name: 我的厚涂风格
description: 固定画师组合与厚涂质感，负面不放 sketch
scope: all
model: all
---

# 我的厚涂风格

- 画师固定使用 artist:wlop 与 artist:ask (askzy)，权重 0.8
- 质感偏厚涂：优先 thick painting、realistic lighting 一类 tag
- 负面提示词里不要放 sketch
- 【V5】可以加一句英文短句描述整体光线
`

export const SHOT_DIR = process.argv.find((a) => a.startsWith('--screenshots='))?.slice('--screenshots='.length)
const WITH_AI = process.argv.includes('--screenshots-ai')

/** 必须在 app ready 之前调用：换到临时用户目录，并复制需要的数据 */
export function prepareScreenshotProfile(): void {
  const realData = join(app.getPath('userData'), 'data')
  const tmp = join(app.getPath('temp'), `novel-prompt-shots-${Date.now()}`)
  mkdirSync(join(tmp, 'data'), { recursive: true })
  if (existsSync(realData)) {
    for (const f of readdirSync(realData)) {
      if (!f.endsWith('.json') || f === 'settings.json' || f.startsWith('mcp')) continue
      copyFileSync(join(realData, f), join(tmp, 'data', f))
    }
  }
  const settings: Record<string, unknown> = {
    skillsMigrated: true,
    skills: [
      { id: 'my-style', enabled: true },
      { id: 'builtin:prompt', enabled: true },
      { id: 'builtin:preview', enabled: true }
    ]
  }
  if (WITH_AI && existsSync(join(realData, 'settings.json'))) {
    const real = JSON.parse(readFileSync(join(realData, 'settings.json'), 'utf8'))
    for (const k of ['apiKey', 'baseUrl', 'model', 'reasoningEffort', 'naiVersion']) if (k in real) settings[k] = real[k]
  }
  writeFileSync(join(tmp, 'data', 'settings.json'), JSON.stringify(settings), 'utf8')
  mkdirSync(join(tmp, 'skills', 'user'), { recursive: true })
  writeFileSync(join(tmp, 'skills', 'user', 'my-style.md'), SAMPLE_SKILL, 'utf8')
  app.setPath('userData', tmp)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function takeScreenshots(win: BrowserWindow): Promise<void> {
  const out = resolve(SHOT_DIR!)
  mkdirSync(out, { recursive: true })
  // 截图期间窗口可能在后台：关闭后台节流，保证页面持续绘制
  win.webContents.setBackgroundThrottling(false)
  win.show()
  win.focus()
  const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>
  const waitFor = async (code: string, timeout: number) => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await js<boolean>(code).catch(() => false)) return true
      await sleep(400)
    }
    return false
  }
  const shot = async (name: string) => {
    await sleep(900) // 等入场动画结束
    for (let i = 0; i < 5; i++) {
      try {
        // 窗口被遮挡或失焦时 capturePage 可能报 UnknownVizError：保持渲染并重试
        if (!win.isVisible()) win.show()
        const img = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        if (img.isEmpty()) throw new Error('empty image')
        writeFileSync(join(out, `${name}.png`), img.toPNG())
        console.log(`[screenshots] ${name}.png`)
        return
      } catch (e) {
        console.log(`[screenshots] ${name} 第 ${i + 1} 次失败：${e instanceof Error ? e.message : e}`)
        win.webContents.invalidate()
        await sleep(800)
      }
    }
    throw new Error(`Failed to capture ${name}`)
  }
  const openTab = (label: string) =>
    js(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click()`)
  const runAndWait = async (view: string) => {
    await js(`document.querySelector('.view.${view} .btn.accent.big')?.click()`)
    await sleep(500)
    const done = await waitFor(`!document.querySelector('.view.${view} .btn.accent.big')?.disabled`, 300_000)
    if (!done) console.log(`[screenshots] ${view} 超时`)
  }

  await prepareWorkspaceDemo()
  // 写入示例提示词后重新加载
  await js(`localStorage.setItem('np-workspace-v1', ${JSON.stringify(JSON.stringify(SAMPLE))}); setTimeout(() => location.reload(), 50); true`)
  await sleep(1500)
  await waitFor(`window.api.dbStatus().then((s) => s.loaded)`, 30_000)
  await sleep(1200)

  await openTab('提示词比对')
  await shot('compare')

  await openTab('AI 优化')
  if (WITH_AI) await runAndWait('ai')
  await shot('ai')

  await openTab('画面推测')
  if (WITH_AI) await runAndWait('preview')
  await shot('preview')

  await openTab('生图预览')
  await waitFor(`!!document.querySelector('.gallery .thumb')`, 5000)
  await js(`document.querySelector('.gallery .thumb')?.click()`)
  await shot('generate')
  await js(`[...document.querySelectorAll('.viewer button')].find(b => b.textContent.includes('局部重绘'))?.click()`)
  if (!await waitFor(`!!document.querySelector('.ip-dialog')`, 5000)) throw new Error('Inpaint editor did not open')
  await shot('inpaint')
  await js(`document.querySelector('.ip-dialog button[title="关闭（Esc）"]')?.click()`)
  await waitFor(`!document.querySelector('.ip-dialog')`, 5000)

  // 角色位置编辑器
  await js(`document.querySelector('button[title="在画布上拖动各角色的位置"]')?.click()`)
  await waitFor(`!!document.querySelector('.pos-dialog')`, 5000)
  await shot('positions')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(400)

  await openTab('Tag 搜索')
  await js(`(() => { const i = document.querySelector('.search-input'); i.value = '双马尾'; i.dispatchEvent(new Event('input')) })()`)
  await sleep(600)
  await shot('search')

  // 侧栏 Skill 启用与优先级
  await js(`document.querySelector('.skill-trigger')?.click()`)
  await waitFor(`!!document.querySelector('.sp-pop .sp-item')`, 5000)
  await shot('skills')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(400)

  await openTab('设置')
  await shot('settings')

  await js(`document.getElementById('skill-manager')?.scrollIntoView({ block: 'start' })`)
  await shot('skill-manager')

  await openTab('AI 工作台')
  if (!await waitFor(`!!document.querySelector('.session-open')`, 5000)) throw new Error('Demo workspace missing')
  await js(`document.querySelector('.session-open').click()`)
  if (!await waitFor(`!!document.querySelector('.pw-shell')`, 5000)) throw new Error('Workspace did not open')
  await shot('workspace')
  await js(`(()=>{const proposal=document.querySelector('.pw-thread .pw-proposal');if(!proposal)throw new Error('Demo proposal missing');proposal.open=true;proposal.scrollIntoView({block:'nearest'})})()`)
  await shot('workspace-suggestions')
  await js(`[...document.querySelectorAll('.pw-view-tabs button')].find(b => b.textContent.includes('修改对比')).click()`)
  await shot('workspace-iterations')

  app.quit()
}
