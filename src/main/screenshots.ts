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
    { prompt: 'girl, silver hair, twin tails, red eyes, white dress, smile, holding hands', negative: 'black hair, glasses', position: 'B3' },
    { prompt: 'girl, black hair, short hair, glasses, school uniform, looking at another, holding hands', negative: 'silver hair, twintails', position: 'D3' }
  ],
  params: { width: 832, height: 1216, qualityTags: true, ucPreset: 'heavy' },
  history: []
}

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
  const settings: Record<string, unknown> = {}
  if (WITH_AI && existsSync(join(realData, 'settings.json'))) {
    const real = JSON.parse(readFileSync(join(realData, 'settings.json'), 'utf8'))
    for (const k of ['apiKey', 'baseUrl', 'model', 'reasoningEffort', 'naiVersion']) if (k in real) settings[k] = real[k]
  }
  writeFileSync(join(tmp, 'data', 'settings.json'), JSON.stringify(settings), 'utf8')
  app.setPath('userData', tmp)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function takeScreenshots(win: BrowserWindow): Promise<void> {
  const out = resolve(SHOT_DIR!)
  mkdirSync(out, { recursive: true })
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
    const img = await win.webContents.capturePage()
    writeFileSync(join(out, `${name}.png`), img.toPNG())
    console.log(`[screenshots] ${name}.png`)
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

  await openTab('Tag 搜索')
  await js(`(() => { const i = document.querySelector('.search-input'); i.value = '双马尾'; i.dispatchEvent(new Event('input')) })()`)
  await sleep(600)
  await shot('search')

  await openTab('设置')
  await shot('settings')

  app.quit()
}
