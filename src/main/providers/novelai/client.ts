import type {
  NaiGenRequest,
  NaiInpaintRequest,
  NaiSubscription,
} from '../../../shared/generation/types'
import { buildBody, buildInpaintBody } from './payload'
import { isPng, readZip } from './png-response'
import { NaiError, request } from './request'

/* ---------- 会员与额度 ---------- */

export const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export async function generateOne(
  req: NaiGenRequest | NaiInpaintRequest,
  seed: number,
  apiToken: string,
  signal?: AbortSignal,
  prepared?: { imageBase64: string; maskBase64: string },
): Promise<Buffer> {
  const res = await request(
    '/ai/generate-image',
    {
      method: 'POST',
      body: JSON.stringify(
        prepared
          ? buildInpaintBody(req as NaiInpaintRequest, seed, prepared)
          : buildBody(req, seed),
      ),
    },
    'application/zip',
    apiToken,
    signal,
  )
  const type = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (/json|text/i.test(type)) {
    throw new NaiError(`接口没有返回图片：${buf.toString('utf8').slice(0, 300)}`)
  }
  const png = isPng(buf) ? buf : readZip(buf).find((entry) => isPng(entry.data))?.data
  if (!png) {
    throw new NaiError('返回内容里没有找到 PNG 图片')
  }
  return png
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
