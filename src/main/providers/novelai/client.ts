import type {
  NaiGenRequest,
  NaiImg2ImgRequest,
  NaiInpaintRequest,
  NaiSubscription,
} from '../../../shared/generation/types'
import { buildBody, buildImg2ImgBody, buildInpaintBody, buildUpscaleBody } from './payload'
import { isPng, readZip } from './png-response'
import { NaiError, request } from './request'

/* ---------- 会员与额度 ---------- */

export const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** 起点图片：局部重绘/扩图需要遮罩，图生图只需要原图 */
export type PreparedSource =
  | { kind: 'infill'; imageBase64: string; maskBase64: string }
  | { kind: 'img2img'; imageBase64: string }

function requestBody(
  req: NaiGenRequest | NaiInpaintRequest | NaiImg2ImgRequest,
  seed: number,
  prepared?: PreparedSource,
) {
  if (prepared?.kind === 'infill') {
    return buildInpaintBody(req as NaiInpaintRequest, seed, prepared)
  }
  if (prepared?.kind === 'img2img') {
    return buildImg2ImgBody(req as NaiImg2ImgRequest, seed, prepared.imageBase64)
  }
  return buildBody(req, seed)
}

export async function generateOne(
  req: NaiGenRequest | NaiInpaintRequest | NaiImg2ImgRequest,
  seed: number,
  apiToken: string,
  signal?: AbortSignal,
  prepared?: PreparedSource,
): Promise<Buffer> {
  const res = await request(
    '/ai/generate-image',
    { method: 'POST', body: JSON.stringify(requestBody(req, seed, prepared)) },
    'application/zip',
    apiToken,
    signal,
  )
  return readImageResponse(res)
}

/**
 * 放大 2 倍。接口返回格式在不同客户端里记录为 ZIP、PNG 或 JSON（images[].image 为 base64），
 * 三种都兼容，避免服务端调整返回格式时直接失败。
 */
export async function upscaleOne(
  imageBase64: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const res = await request(
    '/ai/upscale',
    { method: 'POST', body: JSON.stringify(buildUpscaleBody(imageBase64)) },
    '*/*',
    apiToken,
    signal,
  )
  return readImageResponse(res, true)
}

async function readImageResponse(res: Response, allowJson = false): Promise<Buffer> {
  const type = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (/json|text/i.test(type)) {
    const fromJson = allowJson ? jsonImage(buf) : undefined
    if (fromJson) {
      return fromJson
    }
    throw new NaiError(`接口没有返回图片：${buf.toString('utf8').slice(0, 300)}`)
  }
  const png = isPng(buf) ? buf : readZip(buf).find((entry) => isPng(entry.data))?.data
  if (!png) {
    throw new NaiError('返回内容里没有找到 PNG 图片')
  }
  return png
}

function jsonImage(buf: Buffer): Buffer | undefined {
  try {
    const body = JSON.parse(buf.toString('utf8')) as {
      image?: unknown
      images?: ({ image?: unknown } | string)[]
    }
    const first = body.images?.[0]
    const encoded = typeof first === 'string' ? first : (first?.image ?? body.image)
    if (typeof encoded !== 'string') {
      return undefined
    }
    const bytes = Buffer.from(encoded.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    return isPng(bytes) ? bytes : undefined
  } catch {
    return undefined
  }
}

export async function readSubscription(
  apiToken: string,
  signal?: AbortSignal,
): Promise<NaiSubscription> {
  const res = await request(
    '/user/subscription',
    { method: 'GET' },
    'application/json',
    apiToken,
    signal,
  )
  const record = (await res.json()) as Record<string, unknown>
  const steps = (record.trainingStepsLeft ?? {}) as Record<string, unknown>
  const usage = (record.usage ?? {}) as Record<string, unknown>
  // 字段缺失表示拿不到该项信息，保持 undefined，不强制当成 0
  return {
    active: typeof record.active === 'boolean' ? record.active : undefined,
    tier: num(record.tier),
    anlasFixed: num(steps.fixedTrainingStepsLeft),
    anlasPurchased: num(steps.purchasedTrainingSteps),
    usagePercent: num(usage.percent),
    usageNegative: typeof usage.isNegative === 'boolean' ? usage.isNegative : undefined,
    usageNextSeconds: num(usage.timeUntilNextPercent),
  }
}
