import { net } from 'electron'
import { statSync, readFileSync } from 'node:fs'
import { legacyImageDir, libraryImagePath, listLibraryImages, storeGeneratedImage } from '../image-library'
import type {
  AiCharacter,
  NaiFreeCheck,
  NaiGenParams,
  NaiGenRequest,
  NaiGenResult,
  NaiImage,
  NaiInpaintRequest,
  NaiSubscription,
  NaiVersion
} from '../../shared/types'
import { UC_PRESETS, joinPrompt, parsePosition, withQualityTags } from '../../shared/nai-presets'
import { getSettings } from '../settings'
import { isPng, readZip } from './zip'
import { prepareInpaint, compositeInpaint, type PreparedInpaint } from './inpaint'

/**
 * NovelAI 图像接口（https://image.novelai.net）。
 * 文生图与局部重绘：每次请求 1 张，多张时串行请求。
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
  return legacyImageDir()
}

/** 只接受图库目录下的 png 文件名，防止路径穿越 */
export function imagePath(name: string): string | null {
  return libraryImagePath(name)
}


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

function characterCaptions(chars: AiCharacter[]) {
  const list = chars.filter((c) => c.prompt?.trim())
  const parsed = list.map((c) => parsePosition(c.position))
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

export function buildInpaintBody(req: NaiInpaintRequest, seed: number, prepared: PreparedInpaint): Record<string, unknown> {
  const body = buildBody(req, seed)
  const parameters = body.parameters as Record<string, unknown>
  body.action = 'infill'
  body.model = `${MODEL_ID[req.version]}-inpainting`
  Object.assign(parameters, {
    params_version: 4,
    image: prepared.imageBase64,
    mask: prepared.maskBase64,
    add_original_image: false, // 完整分辨率的选区在本地合成，确保选区外不变
    extra_noise_seed: (seed + 4_294_967_295) >>> 0
  })
  if (req.inpaint.strength < 1) parameters.img2img = { strength: req.inpaint.strength, color_correct: true }
  if (req.version === 'v5' || req.params.noiseSchedule === 'native') parameters.noise_schedule = 'karras'
  if (req.params.sampler === 'k_euler_ancestral') {
    parameters.deliberate_euler_ancestral_bug = false
    parameters.prefer_brownian = true
  }
  return body
}

/* ---------- 图库 ---------- */

export function listImages(limit = 120): NaiImage[] { return listLibraryImages(limit) }

const randomSeed = () => Math.floor(Math.random() * 4_294_967_295)

async function generateOne(req: NaiGenRequest | NaiInpaintRequest, seed: number, signal?: AbortSignal, prepared?: PreparedInpaint): Promise<Buffer> {
  const res = await request(
    '/ai/generate-image',
    { method: 'POST', body: JSON.stringify(prepared ? buildInpaintBody(req as NaiInpaintRequest, seed, prepared) : buildBody(req, seed)) },
    'application/zip',
    signal
  )
  const type = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (/json|text/i.test(type)) throw new NaiError(`接口没有返回图片：${buf.toString('utf8').slice(0, 300)}`)
  const png = isPng(buf) ? buf : readZip(buf).find((e) => isPng(e.data))?.data
  if (!png) throw new NaiError('返回内容里没有找到 PNG 图片')
  return prepared ? compositeInpaint(prepared, png) : png
}

/** Anlas 分项变化（负数 = 扣除）；任一项缺失则无法判断 */
function anlasChange(before?: NaiSubscription, after?: NaiSubscription): { fixed: number; purchased: number } | undefined {
  if (before?.anlasFixed === undefined || after?.anlasFixed === undefined) return undefined
  if (before.anlasPurchased === undefined || after.anlasPurchased === undefined) return undefined
  return { fixed: after.anlasFixed - before.anlasFixed, purchased: after.anlasPurchased - before.anlasPurchased }
}

export async function generateImages(
  req: NaiGenRequest | NaiInpaintRequest,
  onStep: (s: string) => void,
  isCancelled: () => boolean,
  opts: { freeOnly?: boolean; workspaceId?: string } = {}
): Promise<NaiGenResult> {
  // Snapshot both request and retention once, before the first asynchronous operation.
  req = structuredClone(req)
  const storage = opts.workspaceId ? 'workspace' : getSettings().naiAutoSave ? 'saved' : 'temporary'
  let prepared: PreparedInpaint | undefined
  if ('inpaint' in req) {
    if (!req.inpaint || !Number.isFinite(req.inpaint.strength) || req.inpaint.strength < 0.01 || req.inpaint.strength > 1)
      throw new Error('重绘强度必须在 0.01～1 之间')
    if (!['v4.5', 'v5'].includes(req.version) || !Number.isInteger(req.params.steps) || req.params.steps < 1 || req.params.steps > 50 ||
        !Number.isFinite(req.params.scale) || req.params.scale < 0 || req.params.scale > 10 || ![1,2,4].includes(req.params.count))
      throw new Error('局部重绘参数无效，张数须为 1、2 或 4')
    if (req.params.seed !== null && (!Number.isInteger(req.params.seed) || req.params.seed < 0 || req.params.seed > 4_294_967_295))
      throw new Error('种子必须留空或为 0～4294967295 的整数')
    const path = imagePath(req.inpaint.imageName)
    if (!path) throw new Error('原图不存在或已被删除')
    if (statSync(path).size > 40 * 1024 * 1024) throw new Error('原图文件不能超过 40 MB')
    prepared = prepareInpaint(readFileSync(path), req.inpaint.mask, req.params.width, req.params.height)
  }
  const freeOnly = opts.freeOnly ?? getSettings().naiFreeOnly
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
    onStep(`${prepared ? '局部重绘' : '生成'}第 ${i + 1}/${count} 张（种子 ${seed}）…`)
    let png: Buffer
    try {
      png = await generateOne(req, seed, undefined, prepared)
    } catch (e) {
      if (!images.length) throw e
      stopped = `第 ${i + 1} 张失败：${(e as Error).message}`
      break
    }
    const actual = buildBody(req, seed)
    const actualParams = actual.parameters as { negative_prompt: string }
    images.push(storeGeneratedImage(png, {
      schema: 1, createdAt: Date.now(), sourceKind: prepared ? 'inpaint' : 'generate',
      request: { base: actual.input as string, negative: actualParams.negative_prompt,
        characters: req.characters.filter(c => c.prompt?.trim()).map(c => ({ ...c, prompt: c.prompt.trim(), negative: c.negative?.trim() ?? '' })), version: req.version,
        params: { ...req.params, seed, count: 1, qualityTags: false, ucPreset: 'none',
          noiseSchedule: prepared && (req.version === 'v5' || req.params.noiseSchedule === 'native') ? 'karras' : req.params.noiseSchedule } }
    }, storage, opts.workspaceId))

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
