import { app, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
  }
  const openTab = (label: string) =>
    js(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click()`)
  const runAndWait = async (view: string) => {
    await js(`document.querySelector('.view.${view} .btn.accent.big')?.click()`)
    await sleep(500)
    const done = await waitFor(`!document.querySelector('.view.${view} .btn.accent.big')?.disabled`, 300_000)
    if (!done) console.log(`[screenshots] ${view} 超时`)
  }

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
  await shot('generate')

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

  app.quit()
}
