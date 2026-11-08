import { authorizePaidOperation, operationSignal } from '../../infrastructure/operation-policy'
import {
  estimateUpscale,
  anlasOutcomeText,
  type AnlasOutcome,
} from '../../../shared/generation/pricing'
import sharp from 'sharp'
import { PNG } from 'pngjs'
import type { ImageRecipe, NaiImage } from '../../../shared/images/types'
import { upscaleOne } from '../../providers/novelai/client'
import { pngSize } from '../../providers/novelai/png-response'
import { recordAnlas, recordGeneratedImage } from '../statistics/service'
import { storeGeneratedImage } from '../images/library'
import { anlasChange } from './costs'
import { getSubscription, token } from './service'

/** 与局部重绘一致的总像素上限 */
const MAX_PIXELS = 4 * 1024 * 1024
/** 扩图时新画布向原图内部多重绘的一圈，避免接缝；按潜空间 8 像素对齐 */
const OUTPAINT_OVERLAP_PX = 16
/** 放大接口官方客户端 1 Anlas 的上限；超过后价格更高 */
export const UPSCALE_CHEAP_PIXELS = 1024 * 1024
/** 放大接口输入上限 */
export const UPSCALE_MAX_PIXELS = 3_145_728

export interface OutpaintExpansion {
  left: number
  right: number
  top: number
  bottom: number
}

export interface OutpaintCanvas {
  canvas: Buffer
  maskBase64: string
  width: number
  height: number
}

/**
 * 扩图：把原图放进更大的画布，新区域用边缘像素延展填充（比纯色更利于衔接），
 * 遮罩覆盖新区域并向原图内部延伸一圈，交给 infill 模型补全。
 */
export function buildOutpaintCanvas(source: Buffer, expansion: OutpaintExpansion): OutpaintCanvas {
  const sides = [expansion.left, expansion.right, expansion.top, expansion.bottom]
  if (sides.some((size) => !Number.isInteger(size) || size < 0 || size % 64 || size > 2048)) {
    throw new Error('扩展像素须为 0～2048 之间 64 的倍数')
  }
  if (!sides.some((size) => size > 0)) {
    throw new Error('请至少向一个方向扩展')
  }
  const image = PNG.sync.read(source)
  const width = image.width + expansion.left + expansion.right
  const height = image.height + expansion.top + expansion.bottom
  if (width % 64 || height % 64) {
    throw new Error('原图宽高必须是 64 的倍数才能扩图')
  }
  if (width * height > MAX_PIXELS) {
    throw new Error(`扩展后 ${width}×${height} 超过 4096×1024 总像素上限`)
  }
  const canvas = new PNG({ width, height })
  const mask = new PNG({ width, height })
  const innerLeft = expansion.left ? expansion.left + OUTPAINT_OVERLAP_PX : 0
  const innerRight = expansion.right ? width - expansion.right - OUTPAINT_OVERLAP_PX : width
  const innerTop = expansion.top ? expansion.top + OUTPAINT_OVERLAP_PX : 0
  const innerBottom = expansion.bottom ? height - expansion.bottom - OUTPAINT_OVERLAP_PX : height
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.max(0, y - expansion.top))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.max(0, x - expansion.left))
      const from = (sourceY * image.width + sourceX) * 4
      const to = (y * width + x) * 4
      image.data.copy(canvas.data, to, from, from + 3)
      canvas.data[to + 3] = 255
      const keep = x >= innerLeft && x < innerRight && y >= innerTop && y < innerBottom
      mask.data.fill(keep ? 0 : 255, to, to + 3)
      mask.data[to + 3] = 255
    }
  }
  return {
    canvas: PNG.sync.write(canvas),
    maskBase64: PNG.sync.write(mask).toString('base64'),
    width,
    height,
  }
}

/** 增强：按目标尺寸缩放原图（Lanczos），作为图生图的起点 */
export async function resizeForEnhance(
  source: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  if (width * height > MAX_PIXELS) {
    throw new Error(`增强后 ${width}×${height} 超过 4096×1024 总像素上限`)
  }
  return sharp(source)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .png()
    .toBuffer()
}

/**
 * 放大 2 倍：从不免费，只在明确确认后调用。
 * 放大结果沿用原图的提示词记录，尺寸改为实际结果，便于图库与收藏读回。
 */
export async function upscaleImage(
  source: Buffer,
  recipe: ImageRecipe | null,
  onStep: (text: string) => void,
  options: { freeOnly?: boolean; workspaceId?: string; collectionId?: string },
): Promise<{ image: NaiImage } & AnlasOutcome> {
  if (options.freeOnly) {
    throw new Error('放大始终消耗 Anlas，「仅免费生成」开启时不能放大')
  }
  const size = pngSize(source)
  if (!size) {
    throw new Error('原图不是有效 PNG')
  }
  if (size.width * size.height > UPSCALE_MAX_PIXELS) {
    throw new Error(`原图 ${size.width}×${size.height} 超过放大接口的输入上限`)
  }
  await authorizePaidOperation({
    kind: 'image.upscale',
    provider: 'NovelAI',
    description: '放大图片 2×',
    quantity: 1,
    unit: 'Anlas',
    estimatedCost: estimateUpscale(size.width, size.height),
  })
  onStep('查询会员与额度…')
  const before = await getSubscription().catch(() => undefined)
  onStep(`正在放大 ${size.width}×${size.height} → ${size.width * 2}×${size.height * 2}…`)
  const signal = operationSignal()
  if (signal?.aborted) {
    throw new Error('已取消')
  }
  const bytes = await upscaleOne(source.toString('base64'), token(), signal)
  const after = await getSubscription().catch(() => undefined)
  const change = anlasChange(before, after)
  const version = recipe?.request.version ?? 'v5'
  recordAnlas(version, change)
  const actualSize = pngSize(bytes) ?? { width: size.width * 2, height: size.height * 2 }
  const storedRecipe: ImageRecipe = recipe
    ? {
        ...recipe,
        createdAt: Date.now(),
        request: {
          ...recipe.request,
          params: { ...recipe.request.params, ...actualSize },
        },
      }
    : {
        schema: 1,
        createdAt: Date.now(),
        sourceKind: 'legacy',
        request: {
          base: '',
          negative: '',
          characters: [],
          version,
          params: {
            ...actualSize,
            steps: 0,
            scale: 0,
            cfgRescale: 0,
            sampler: 'k_euler',
            noiseSchedule: 'karras',
            seed: null,
            count: 1,
            qualityTags: false,
            ucPreset: 'none',
          },
        },
      }
  const image = storeGeneratedImage(
    bytes,
    storedRecipe,
    options.workspaceId ? 'workspace' : 'saved',
    options.workspaceId,
    options.collectionId,
  )
  recordGeneratedImage(version)
  const result = {
    image,
    anlasDelta: change ? change.fixed + change.purchased : undefined,
    subscription: after,
  }
  onStep(`完成 · ${anlasOutcomeText(result)}`)
  return result
}
