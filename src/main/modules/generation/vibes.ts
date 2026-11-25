import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  VIBE_ENCODE_FEE,
  validVibes,
  type VibeCacheStatus,
  type VibeReference,
} from '../../../shared/generation/vibes'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import { authorizePaidOperation } from '../../infrastructure/operation-policy'
import { encodeVibe, readSubscription } from '../../providers/novelai/client'
import { MODEL_ID } from '../../providers/novelai/payload'
import { NaiError } from '../../providers/novelai/request'
import { imageLibraryDir, libraryImagePath } from '../images/library'
import { getSettings } from '../settings/service'
import { recordAnlas } from '../statistics/service'
import { anlasChange } from './costs'

const encoding = new Set<string>()
const maximumBytes = 4 * 1024 * 1024
const directory = () => join(imageLibraryDir(), 'vibes')

function cachePath(vibe: VibeReference) {
  const hash = createHash('sha256')
    .update(JSON.stringify([MODEL_ID['v4.5'], vibe.imageName, vibe.information]))
    .digest('hex')
  return join(directory(), vibe.imageName.slice(4, -4) + '-' + hash + '.bin')
}

function isUsable(path: string): boolean {
  if (!existsSync(path)) {
    return false
  }
  const size = statSync(path).size
  return size > 0 && size <= maximumBytes
}

function status(vibe: VibeReference): VibeCacheStatus {
  const path = cachePath(vibe)
  if (isUsable(path)) {
    return 'ready'
  }
  return existsSync(path + '.pending') || existsSync(path) ? 'uncertain' : 'missing'
}

export function vibeStatuses(entries: VibeReference[]): VibeCacheStatus[] {
  if (!validVibes(entries)) {
    throw new Error('Vibe Transfer 配置无效')
  }
  return entries.map(status)
}

export function preparedVibes(entries: VibeReference[]): string[] {
  return entries.map((entry) => {
    if (status(entry) !== 'ready') {
      throw new Error('请先在 Vibe Transfer 面板完成参考图编码')
    }
    return readFileSync(cachePath(entry)).toString('base64')
  })
}

export async function encodeReferenceVibe(
  entry: VibeReference,
): Promise<{ cached: boolean; charge: number | null }> {
  if (!validVibes([entry])) {
    throw new Error('Vibe Transfer 配置无效')
  }
  const path = cachePath(entry)
  const latest = status(entry)
  if (latest === 'ready') {
    return { cached: true, charge: 0 }
  }
  if (encoding.has(path) || latest === 'uncertain') {
    throw new Error('这张图正在编码或上次编码结果未知，请核对 Anlas 和编码记录')
  }
  const token = getSettings().naiToken
  const imagePath = libraryImagePath(entry.imageName)
  if (!token || !imagePath) {
    throw new Error('请配置 NovelAI Token 并选择仍可读取的参考图')
  }
  encoding.add(path)
  try {
    const bytes = readFileSync(imagePath)
    if (entry.imageName !== 'ref-' + createHash('sha256').update(bytes).digest('hex') + '.png') {
      throw new Error('参考素材已变化，请重新导入')
    }
    await authorizePaidOperation({
      kind: 'image.encode-vibe',
      provider: 'NovelAI',
      description: 'V4.5 Vibe Transfer 编码 1 张参考图',
      quantity: 1,
      estimatedCost: VIBE_ENCODE_FEE,
      unit: 'Anlas',
    })
    const before = await readSubscription(token)
    if (before.anlasFixed === undefined || before.anlasPurchased === undefined) {
      throw new Error('无法读取编码前的完整 Anlas 余额')
    }
    mkdirSync(directory(), { recursive: true })
    const pending = path + '.pending'
    writeFileAtomic(pending, JSON.stringify({ when: Date.now(), image: entry.imageName }))
    try {
      const encoded = await encodeVibe(bytes.toString('base64'), entry.information, token)
      if (!encoded.length || encoded.length > maximumBytes) {
        throw new Error('NovelAI 编码结果无效，费用结果待核对')
      }
      writeFileAtomic(path, encoded)
    } catch (error) {
      if (error instanceof NaiError && [400, 401, 402, 403, 422, 429].includes(error.status ?? 0)) {
        unlinkSync(pending)
      }
      throw error
    }
    unlinkSync(pending)
    const after = await readSubscription(token).catch(() => undefined)
    const change = anlasChange(before, after)
    recordAnlas('v4.5', change)
    return { cached: false, charge: change ? -(change.fixed + change.purchased) : null }
  } finally {
    encoding.delete(path)
  }
}
