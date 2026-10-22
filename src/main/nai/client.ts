import { app, net } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AiCharacter,
  NaiFreeCheck,
  NaiGenParams,
  NaiGenRequest,
  NaiGenResult,
  NaiImage,
  NaiSubscription,
  NaiVersion
} from '../../shared/types'
import { UC_PRESETS, joinPrompt, withQualityTags } from '../../shared/nai-presets'
import { getSettings } from '../settings'
import { isPng, pngSize, readZip } from './zip'

/**
 * NovelAI 图像接口（https://image.novelai.net）。
 * 只做普通文生图：每次请求 1 张，多张时串行请求。
 * Token 只放在请求头，任何错误信息里都不会带出 Token。
 */

const HOST = 'https://image.novelai.net'
const TIMEOUT = 180_000
/** 免费生成的像素上限（总像素，不是单边） */
export const FREE_MAX_PIXELS = 1024 * 1024
export const FREE_MAX_STEPS = 28
/** V5 免费额度剩余低于此百分比时不再提交，避免贴着耗尽边缘生成 */
const FREE_MIN_PERCENT = 2

export const MODEL_ID: Record<NaiVersion, string> = {
  'v4.5': 'nai-diffusion-4-5-full',
  v5: 'nai-diffusion-5-full'
}

export const IMAGE_SCHEME = 'np-img'

export function imageDir(): string {
  const dir = join(app.getPath('userData'), 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 只接受图库目录下的 png 文件名，防止路径穿越 */
export function imagePath(name: string): string | null {
  if (!/^[\w.-]+\.png$/i.test(name)) return null
  const p = join(imageDir(), name)
  return existsSync(p) ? p : null
}

const urlOf = (name: string) => `${IMAGE_SCHEME}://img/${encodeURIComponent(name)}`

function token(): string {
  const t = getSettings().naiToken.trim()
  if (!t) throw new Error('请先在「设置 / 数据」中填写 NovelAI API Token')
  return t
}

class NaiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

async function errorMessage(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text) as { message?: string; error?: string }
      detail = j.message ?? j.error ?? text
    } catch {
      detail = text
    }
  } catch {
    /* ignore */
  }
  detail = detail.replace(/pst-[\w-]+/g, 'pst-***').slice(0, 300)
  const s = res.status
  const head =
    s === 400 || s === 422
      ? '请求参数不被接受'
      : s === 401 || s === 403
        ? 'Token 无效或没有权限，请检查设置里的 NovelAI Token'
        : s === 402
          ? '余额不足或当前会员不支持该请求'
          : s === 429
            ? '请求太频繁，被限流了，请稍等再试'
            : s >= 500
              ? '服务端出错，结果不确定：重试前请先看看图库和 Anlas 余额，避免重复生成'
              : '请求失败'
  return `${head}（HTTP ${s}）${detail ? `：${detail}` : ''}`
}

async function request(path: string, init: RequestInit, accept: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT)
  let res: Response
  try {
    res = await net.fetch(`${HOST}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token()}`, Accept: accept, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'TimeoutError')
      throw new NaiError('请求超时：服务端可能已经在生成，重试前请先确认图库和 Anlas 余额，避免重复扣费')
    if (name === 'AbortError') throw new NaiError('已取消')
    throw new NaiError(`网络错误：${String((e as Error)?.message ?? e).replace(/pst-[\w-]+/g, 'pst-***')}`)
  }
  if (!res.ok) throw new NaiError(await errorMessage(res), res.status)
  return res
}

/* ---------- 会员与额度 ---------- */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export async function getSubscription(signal?: AbortSignal): Promise<NaiSubscription> {
  const res = await request('/user/subscription', { method: 'GET' }, 'application/json', signal)
  const j = (await res.json()) as Record<string, unknown>
  const steps = (j.trainingStepsLeft ?? {}) as Record<string, unknown>
  const usage = (j.usage ?? {}) as Record<string, unknown>
  // 字段缺失表示拿不到该项信息，保持 undefined，不强制当成 0
  return {
    active: typeof j.active === 'boolean' ? j.active : undefined,
    tier: num(j.tier),
    anlasFixed: num(steps.fixedTrainingStepsLeft),
    anlasPurchased: num(steps.purchasedTrainingSteps),
    usagePercent: num(usage.percent),
    usageNegative: typeof usage.isNegative === 'boolean' ? usage.isNegative : undefined,
    usageNextSeconds: num(usage.timeUntilNextPercent)
  }
}

/** 调用端的免费资格检查：服务端才是最终决定者，所以生成后还要核对余额 */
export function freeCheck(params: Pick<NaiGenParams, 'width' | 'height' | 'steps'>, version: NaiVersion, sub?: NaiSubscription): NaiFreeCheck {
  const reasons: string[] = []
  const notes: string[] = []
  if (params.width * params.height > FREE_MAX_PIXELS)
    reasons.push(`尺寸 ${params.width}×${params.height} 超过免费上限（总像素不超过 1024×1024）`)
  if (params.steps > FREE_MAX_STEPS) reasons.push(`步数 ${params.steps} 超过免费上限 ${FREE_MAX_STEPS}`)
  if (!sub) reasons.push('还没查询到会员状态')
  else {
    if (sub.active !== true || sub.tier !== 3) reasons.push('不是有效的 Opus 会员（只有 Opus 有免费生成）')
    if (version === 'v5') {
      if (sub.usageNegative === true) reasons.push('V5 免费额度处于负值')
      else if (sub.usagePercent === undefined) reasons.push('接口没有返回 V5 免费额度，无法确认免费资格')
      else if (sub.usagePercent < FREE_MIN_PERCENT) reasons.push(`V5 免费额度只剩约 ${sub.usagePercent}%，为避免贴边扣费已暂停`)
    } else {
      notes.push('V4.5 的免费规则没有像 V5 那样的额度读数，每张生成后都会核对 Anlas，发现扣除立即停止')
    }
  }
  notes.push('是否扣费由服务端决定，生成后会核对两类 Anlas 余额')
  return { ok: !reasons.length, reasons, notes }
}

/* ---------- 请求体 ---------- */

/** 角色位置 → 归一化坐标：支持 V4.5 网格（B3）和「0.3,0.5」两种写法 */
function centerOf(position?: string): { x: number; y: number } | null {
  const p = position?.trim() ?? ''
  const grid = /^([A-E])\s*([1-5])$/i.exec(p)
  if (grid) return { x: ('ABCDE'.indexOf(grid[1].toUpperCase()) + 0.5) / 5, y: (Number(grid[2]) - 0.5) / 5 }
  const xy = /^(0?\.\d+|[01](?:\.0+)?)\s*[,，\s]\s*(0?\.\d+|[01](?:\.0+)?)$/.exec(p)
  if (xy) return { x: Number(xy[1]), y: Number(xy[2]) }
  return null
}

function characterCaptions(chars: AiCharacter[]) {
  const list = chars.filter((c) => c.prompt?.trim())
  const parsed = list.map((c) => centerOf(c.position))
  const useCoords = parsed.some(Boolean)
  // 有任意角色指定了位置就启用坐标，没写位置的角色按顺序从左到右均匀排开
  const centers = parsed.map((c, i) => c ?? { x: Math.round(((i + 1) / (list.length + 1)) * 10) / 10, y: 0.5 })
  return {
    useCoords,
    positive: list.map((c, i) => ({ char_caption: c.prompt.trim(), centers: [centers[i]] })),
    negative: list.map((c, i) => ({ char_caption: c.negative?.trim() ?? '', centers: [centers[i]] }))
  }
}

export function buildBody(req: NaiGenRequest, seed: number): Record<string, unknown> {
  const p = req.params
  const input = p.qualityTags ? withQualityTags(req.base, req.version) : req.base.trim()
  const negative = joinPrompt(req.negative, UC_PRESETS[req.version][p.ucPreset])
  const chars = characterCaptions(req.characters)
  return {
    input,
    model: MODEL_ID[req.version],
    action: 'generate',
    parameters: {
      params_version: 3,
      width: p.width,
      height: p.height,
      steps: p.steps,
      scale: p.scale,
      cfg_rescale: p.cfgRescale,
      n_samples: 1,
      seed,
      sampler: p.sampler,
      noise_schedule: p.noiseSchedule,
      // 质量词和 UC 预设已由本工具显式拼进提示词，服务端开关保持关闭，发送的内容就是最终内容
      qualityToggle: false,
      ucPreset: 3,
      negative_prompt: negative,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      legacy: false,
      legacy_v3_extend: false,
      v4_prompt: {
        caption: { base_caption: input, char_captions: chars.positive },
        use_coords: chars.useCoords,
        use_order: true
      },
      v4_negative_prompt: {
        caption: { base_caption: negative, char_captions: chars.negative },
        legacy_uc: false
      }
    }
  }
}

/* ---------- 图库 ---------- */

function stamp(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

function saveImage(png: Buffer, seed: number): NaiImage {
  let name = `${stamp()}-${seed}.png`
  for (let i = 2; existsSync(join(imageDir(), name)); i++) name = `${stamp()}-${seed}-${i}.png`
  writeFileSync(join(imageDir(), name), png)
  const size = pngSize(png)
  return { name, url: urlOf(name), seed, width: size?.width, height: size?.height, createdAt: Date.now() }
}

function readHeader(path: string): Buffer {
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.alloc(24)
    readSync(fd, b, 0, 24, 0)
    return b
  } finally {
    closeSync(fd)
  }
}

export function listImages(limit = 120): NaiImage[] {
  const dir = imageDir()
  return readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({ name, at }) => {
      const size = (() => {
        try {
          return pngSize(readHeader(join(dir, name)))
        } catch {
          return undefined
        }
      })()
      const seed = /-(\d+)(?:-\d+)?\.png$/i.exec(name)?.[1]
      return { name, url: urlOf(name), seed: seed ? Number(seed) : undefined, width: size?.width, height: size?.height, createdAt: at }
    })
}

/* ---------- 生成 ---------- */

const randomSeed = () => Math.floor(Math.random() * 4_294_967_295)

async function generateOne(req: NaiGenRequest, seed: number, signal?: AbortSignal): Promise<Buffer> {
  const res = await request(
    '/ai/generate-image',
    { method: 'POST', body: JSON.stringify(buildBody(req, seed)) },
    'application/zip',
    signal
  )
  const type = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (/json|text/i.test(type)) throw new NaiError(`接口没有返回图片：${buf.toString('utf8').slice(0, 300)}`)
  const png = isPng(buf) ? buf : readZip(buf).find((e) => isPng(e.data))?.data
  if (!png) throw new NaiError('返回内容里没有找到 PNG 图片')
  return png
}

/** Anlas 分项变化（负数 = 扣除）；任一项缺失则无法判断 */
function anlasChange(before?: NaiSubscription, after?: NaiSubscription): { fixed: number; purchased: number } | undefined {
  if (before?.anlasFixed === undefined || after?.anlasFixed === undefined) return undefined
  if (before.anlasPurchased === undefined || after.anlasPurchased === undefined) return undefined
  return { fixed: after.anlasFixed - before.anlasFixed, purchased: after.anlasPurchased - before.anlasPurchased }
}

export async function generateImages(
  req: NaiGenRequest,
  onStep: (s: string) => void,
  isCancelled: () => boolean
): Promise<NaiGenResult> {
  const freeOnly = getSettings().naiFreeOnly
  const count = Math.max(1, Math.min(8, Math.floor(req.params.count || 1)))
  const images: NaiImage[] = []
  let delta: number | undefined = 0
  let stopped: string | undefined

  onStep('查询会员与额度…')
  let sub: NaiSubscription | undefined
  try {
    sub = await getSubscription()
  } catch (e) {
    if (freeOnly) throw new Error(`查询会员状态失败，无法确认免费资格：${(e as Error).message}`)
  }

  for (let i = 0; i < count; i++) {
    if (isCancelled()) {
      stopped = images.length ? `已取消，完成了 ${images.length} 张` : '已取消'
      break
    }
    if (freeOnly) {
      const check = freeCheck(req.params, req.version, sub)
      if (!check.ok) {
        stopped = `不满足免费条件，已停止：${check.reasons.join('；')}`
        break
      }
    }
    const seed = req.params.seed != null && Number.isFinite(req.params.seed) ? (req.params.seed + i) >>> 0 : randomSeed()
    onStep(`生成第 ${i + 1}/${count} 张（种子 ${seed}）…`)
    let png: Buffer
    try {
      png = await generateOne(req, seed)
    } catch (e) {
      if (!images.length) throw e
      stopped = `第 ${i + 1} 张失败：${(e as Error).message}`
      break
    }
    images.push(saveImage(png, seed))

    // 事后核验：分别比较订阅 Anlas 与购买 Anlas，只看总和可能掩盖分项变化
    let after: NaiSubscription | undefined
    try {
      after = await getSubscription()
    } catch {
      delta = undefined
      if (freeOnly) {
        stopped = '生成后查询余额失败，无法确认是否扣费，已停止后续生成'
        break
      }
    }
    const change = anlasChange(sub, after)
    if (change && delta !== undefined) delta += change.fixed + change.purchased
    else if (!change) delta = undefined
    if (freeOnly && (!change || change.fixed < 0 || change.purchased < 0)) {
      stopped = change
        ? `检测到扣除了 Anlas（订阅 ${change.fixed}、购买 ${change.purchased}），已停止后续生成`
        : '无法读取 Anlas 余额，无法确认是否扣费，已停止后续生成'
      sub = after
      break
    }
    sub = after ?? sub
  }

  onStep(stopped ?? '完成')
  return { images, anlasDelta: delta, stopped, subscription: sub }
}
