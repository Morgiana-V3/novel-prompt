import { nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import type {
  PageInputContext,
  PageInputImage,
  PageInputRegion,
} from '../../../shared/workspace/context'
import type { PageVersion } from '../../../shared/workspace/model'
import type { ChatPart } from '../../providers/chat/client'
import { prepareInpaint } from '../generation/inpaint'
import { imagePath } from '../images/access'
import { fileSignature } from './storage-paths'

interface EncodedImage {
  url: string
  bounds?: PageInputRegion['bounds']
}

const encodedImages = new Map<string, EncodedImage>()
const MAX_CACHE_ENTRIES = 24
const MAX_CACHE_BYTES = 16 * 1024 * 1024
let cachedBytes = 0
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

function encoded(key: string, build: () => EncodedImage): EncodedImage {
  const cached = encodedImages.get(key)
  if (cached) {
    encodedImages.delete(key)
    encodedImages.set(key, cached)
    return cached
  }
  const result = build()
  const bytes = result.url.length * 2
  if (bytes <= MAX_CACHE_BYTES) {
    encodedImages.set(key, result)
    cachedBytes += bytes
    while (encodedImages.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
      const oldest = encodedImages.keys().next().value!
      cachedBytes -= encodedImages.get(oldest)!.url.length * 2
      encodedImages.delete(oldest)
    }
  }
  return result
}

function encodePicture(bytes: Buffer): EncodedImage {
  let image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) {
    throw new Error('图片无法读取')
  }
  const { width, height } = image.getSize()
  if (Math.max(width, height) > 1280) {
    image = image.resize(width > height ? { width: 1280 } : { height: 1280 })
  }
  return { url: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}` }
}

export function picture(bytes: Buffer): ChatPart {
  return {
    type: 'image_url',
    image_url: { url: encoded(digest(bytes), () => encodePicture(bytes)).url },
  }
}

function markedRegion(bytes: Buffer, mask: string, width: number, height: number): EncodedImage {
  const prepared = prepareInpaint(bytes, mask, width, height)
  const source = prepared.source
  let left = source.width
  let top = source.height
  let right = 0
  let bottom = 0
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const offset = (y * source.width + x) * 4
      if (!prepared.mask.data[offset]) {
        continue
      }
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      for (let channel = 0; channel < 3; channel++) {
        source.data[offset + channel] = Math.round(
          source.data[offset + channel] * 0.7 + [255, 107, 154][channel] * 0.3,
        )
      }
    }
  }
  const x = Math.max(0, left - 48)
  const y = Math.max(0, top - 48)
  const crop = nativeImage.createFromBuffer(PNG.sync.write(source)).crop({
    x,
    y,
    width: Math.min(source.width, right + 49) - x,
    height: Math.min(source.height, bottom + 49) - y,
  })
  return {
    ...encodePicture(crop.toPNG()),
    bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
  }
}

function roleText(entry: PageInputImage): string {
  const identity = `「${entry.label}」，versionId=${entry.versionId}`
  if (entry.role === 'edit-target') {
    return `当前采用图片，也是修改目标：${identity}。`
  }
  if (entry.role === 'discussion') {
    return `用户本轮正在讨论的图片：${identity}。讨论对象不改变当前修改目标。`
  }
  if (entry.role === 'region') {
    return `修改目标的区域 ${identity}，regionId=${entry.regionId}，不是其他候选图的选区。粉色仅标记选区，原始颜色请看整页。`
  }
  return `用户引用的历史图片 ${identity}，仅参考，当前采用版本未切换。`
}

/** Preserve every role label, but include identical encoded bytes only once per request. */
function assembleImages(context: PageInputContext, version: PageVersion): ChatPart[] {
  const parts: ChatPart[] = []
  const sources = new Map<string, { bytes: Buffer; hash: string; signature: string }>()
  const delivered = new Map<string, string>()
  for (const entry of context.images.entries) {
    const path = entry.imageName ? imagePath(entry.imageName) : null
    if (!path) {
      entry.status = entry.imageName ? 'missing' : 'none'
      parts.push({
        type: 'text',
        text: roleText(entry) + '图片不可用，只能依据文字记录，不能声称看过画面。',
      })
      continue
    }
    const signature = fileSignature(path)
    let source = sources.get(path)
    if (!source || source.signature !== signature) {
      const bytes = readFileSync(path)
      if (fileSignature(path) !== signature) {
        throw new Error('图片在装配讨论输入时已改变，请重新读取当前状态')
      }
      source = { bytes, hash: digest(bytes), signature }
      sources.set(path, source)
    }
    const expected = [
      context.editTarget.image,
      context.discussion.image,
      ...context.references.map((reference) => reference.image),
    ].find((image) => image?.name === entry.imageName)
    if (expected?.contentHash && expected.contentHash !== source.hash) {
      throw new Error('图片已不同于本轮读取的版本，请重新读取当前状态')
    }
    let image: EncodedImage
    if (entry.role === 'region') {
      const region = version.editor.regions.find((item) => item.id === entry.regionId)
      if (!region) {
        throw new Error('讨论选区已不存在')
      }
      const { width, height } = context.editTarget.params
      const key = `region:${source.hash}:${digest(region.mask)}:${width}:${height}`
      image = encoded(key, () => markedRegion(source.bytes, region.mask, width, height))
      const selected = context.selectedRegions.find((item) => item.id === region.id)
      if (selected) {
        selected.bounds = image.bounds ?? null
      }
    } else {
      image = encoded(source.hash, () => encodePicture(source.bytes))
    }
    entry.sourceSignature = `${source.hash}:${signature}`
    entry.status = 'included'
    const imageKey = digest(image.url)
    entry.sharedWith = delivered.get(imageKey)
    parts.push({
      type: 'text',
      text:
        roleText(entry) + (entry.sharedWith ? `与输入 ${entry.sharedWith} 共用同一图片字节。` : ''),
    })
    if (!entry.sharedWith) {
      parts.push({ type: 'image_url', image_url: { url: image.url } })
      delivered.set(imageKey, entry.id)
    }
  }
  context.images.mode = delivered.size ? 'included' : 'none'
  if (!delivered.size && context.images.entries.some((entry) => entry.status === 'missing')) {
    context.images.mode = 'missing'
  }
  for (const [path, source] of sources) {
    if (fileSignature(path) !== source.signature) {
      throw new Error('图片在装配讨论输入时已改变，请重新读取当前状态')
    }
  }
  return parts
}

export function assembleDiscussionImages(
  context: PageInputContext,
  version: PageVersion,
): ChatPart[] {
  try {
    return assembleImages(context, version)
  } catch (error) {
    context.images.mode = 'unassembled'
    for (const entry of context.images.entries) {
      if (entry.status === 'included') {
        entry.status = 'available'
      }
      delete entry.sharedWith
      delete entry.sourceSignature
    }
    for (const region of context.selectedRegions) {
      region.bounds = null
    }
    throw error
  }
}

/** Records actual text fallback, without claiming the model saw or understood an image. */
export function recordImageDelivery(context: PageInputContext, route: string | undefined): void {
  if (route !== 'text') {
    return
  }
  context.images.mode = 'text-only'
  for (const entry of context.images.entries) {
    if (entry.status === 'included') {
      entry.status = 'text-only'
    }
  }
}
