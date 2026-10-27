import { isNaiVersion } from '../../../shared/generation/types'
import { readFileSync, statSync } from 'node:fs'
import type {
  NaiGenRequest,
  NaiGenResult,
  NaiInpaintRequest,
  NaiSubscription,
} from '../../../shared/generation/types'
import type { NaiImage } from '../../../shared/images/types'
import { generateOne, readSubscription } from '../../providers/novelai/client'
import { buildBody } from '../../providers/novelai/payload'
import { imagePath } from '../images/access'
import { storeGeneratedImage } from '../images/library'
import { getSettings } from '../settings/service'
import { anlasChange, freeCheck } from './costs'
import { compositeInpaint, prepareInpaint, type PreparedInpaint } from './inpaint'

export function token(): string {
  const text = getSettings().naiToken.trim()
  if (!text) {
    throw new Error('请先在「设置 / 数据」中填写 NovelAI API Token')
  }
  return text
}
export async function getSubscription(signal?: AbortSignal): Promise<NaiSubscription> {
  return readSubscription(token(), signal)
}

export const randomSeed = () => Math.floor(Math.random() * 4_294_967_295)

export async function generateImages(
  req: NaiGenRequest | NaiInpaintRequest,
  onStep: (text: string) => void,
  isCancelled: () => boolean,
  opts: { freeOnly?: boolean; workspaceId?: string } = {},
): Promise<NaiGenResult> {
  // Snapshot both request and retention once, before the first asynchronous operation.
  req = structuredClone(req)
  const resolveStorage = () => {
    if (opts.workspaceId) {
      return 'workspace' as const
    }
    if (getSettings().naiAutoSave) {
      return 'saved' as const
    }
    return 'temporary' as const
  }
  const storage = resolveStorage()
  let prepared: PreparedInpaint | undefined
  if ('inpaint' in req) {
    if (
      !req.inpaint ||
      !Number.isFinite(req.inpaint.strength) ||
      req.inpaint.strength < 0.01 ||
      req.inpaint.strength > 1
    ) {
      throw new Error('重绘强度必须在 0.01～1 之间')
    }
    if (
      !isNaiVersion(req.version) ||
      !Number.isInteger(req.params.steps) ||
      req.params.steps < 1 ||
      req.params.steps > 50 ||
      !Number.isFinite(req.params.scale) ||
      req.params.scale < 0 ||
      req.params.scale > 10 ||
      ![1, 2, 4].includes(req.params.count)
    ) {
      throw new Error('局部重绘参数无效，张数须为 1、2 或 4')
    }
    if (
      req.params.seed !== null &&
      (!Number.isInteger(req.params.seed) || req.params.seed < 0 || req.params.seed > 4_294_967_295)
    ) {
      throw new Error('种子必须留空或为 0～4294967295 的整数')
    }
    const path = imagePath(req.inpaint.imageName)
    if (!path) {
      throw new Error('原图不存在或已被删除')
    }
    if (statSync(path).size > 40 * 1024 * 1024) {
      throw new Error('原图文件不能超过 40 MB')
    }
    prepared = prepareInpaint(
      readFileSync(path),
      req.inpaint.mask,
      req.params.width,
      req.params.height,
    )
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
  } catch (error) {
    if (freeOnly) {
      throw new Error(`查询会员状态失败，无法确认免费资格：${(error as Error).message}`)
    }
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
    const seed =
      req.params.seed != null && Number.isFinite(req.params.seed)
        ? (req.params.seed + i) >>> 0
        : randomSeed()
    onStep(`${prepared ? '局部重绘' : '生成'}第 ${i + 1}/${count} 张（种子 ${seed}）…`)
    let png: Buffer
    try {
      png = await generateOne(req, seed, token(), undefined, prepared)
      if (prepared) {
        png = compositeInpaint(prepared, png)
      }
    } catch (error2) {
      if (!images.length) {
        throw error2
      }
      stopped = `第 ${i + 1} 张失败：${(error2 as Error).message}`
      break
    }
    const actual = buildBody(req, seed)
    const actualParams = actual.parameters as { negative_prompt: string }
    images.push(
      storeGeneratedImage(
        png,
        {
          schema: 1,
          createdAt: Date.now(),
          sourceKind: prepared ? 'inpaint' : 'generate',
          request: {
            base: actual.input as string,
            negative: actualParams.negative_prompt,
            characters: req.characters
              .filter((character) => character.prompt?.trim())
              .map((character) => ({
                ...character,
                prompt: character.prompt.trim(),
                negative: character.negative?.trim() ?? '',
              })),
            version: req.version,
            params: {
              ...req.params,
              seed,
              count: 1,
              qualityTags: false,
              ucPreset: 'none',
              noiseSchedule:
                prepared && (req.version === 'v5' || req.params.noiseSchedule === 'native')
                  ? 'karras'
                  : req.params.noiseSchedule,
            },
          },
        },
        storage,
        opts.workspaceId,
      ),
    )

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
    if (change && delta !== undefined) {
      delta += change.fixed + change.purchased
    } else if (!change) {
      delta = undefined
    }
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
