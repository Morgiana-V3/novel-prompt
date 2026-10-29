import { crc32, inflateSync } from 'node:zlib'
import type { ImageRecipe } from '../../../shared/images/types'
import { recipeFromTexts, validRecipe } from '../../../shared/images/metadata'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const textTypes = new Set(['tEXt', 'zTXt', 'iTXt'])
const maxText = 8 * 1024 * 1024

function chunks(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(signature)) {
    throw new Error('不是有效的 PNG 图片')
  }
  const result: { type: string; data: Buffer; raw: Buffer }[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) {
      throw new Error('PNG 数据不完整')
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, end - 4)
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error('PNG 校验失败')
    }
    result.push({ type, data, raw: bytes.subarray(offset, end) })
    offset = end
    if (type === 'IEND') {
      if (offset !== bytes.length || result[0]?.type !== 'IHDR') {
        throw new Error('PNG 格式异常')
      }
      return result
    }
  }
  throw new Error('PNG 缺少结束标记')
}

function ownChunk(chunk: { type: string; data: Buffer }): boolean {
  return (
    textTypes.has(chunk.type) &&
    chunk.data.subarray(0, chunk.data.indexOf(0)).toString('ascii') === 'NovelPrompt'
  )
}

export function pngTexts(bytes: Buffer): Record<string, string> {
  const texts: Record<string, string> = Object.create(null)
  for (const { type, data } of chunks(bytes)) {
    if (!textTypes.has(type)) {
      continue
    }
    const end = data.indexOf(0)
    if (end < 1) {
      continue
    }
    const key = data.subarray(0, end).toString('latin1')
    let body = data.subarray(end + 1)
    if (type === 'zTXt') {
      body = inflateSync(data.subarray(end + 2), { maxOutputLength: maxText })
    } else if (type === 'iTXt') {
      const language = data.indexOf(0, end + 3)
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1)
      if (translated < 0) {
        throw new Error('PNG 文本记录不完整')
      }
      body = data.subarray(translated + 1)
      if (data[end + 1] === 1) {
        body = inflateSync(body, { maxOutputLength: maxText })
      }
    }
    if (body.length > maxText) {
      throw new Error('PNG 文本记录过大')
    }
    if (key === 'NovelPrompt' && texts[key] !== undefined) {
      throw new Error('图片包含冲突的生成记录')
    }
    texts[key] = body.toString('utf8')
  }
  return texts
}

export function readPngRecipe(bytes: Buffer, createdAt = 0): ImageRecipe | null {
  return recipeFromTexts(pngTexts(bytes), createdAt)
}

export function embedRecipe(bytes: Buffer, recipe: ImageRecipe): Buffer {
  if (!validRecipe(recipe)) {
    throw new Error('图片生成记录不完整，无法保存')
  }
  const body = Buffer.concat([
    Buffer.from('NovelPrompt\0\0\0\0\0', 'ascii'),
    Buffer.from(JSON.stringify(recipe), 'utf8'),
  ])
  if (body.length > maxText) {
    throw new Error('图片生成记录过大')
  }
  const chunk = Buffer.alloc(body.length + 12)
  chunk.writeUInt32BE(body.length, 0)
  chunk.write('iTXt', 4, 'ascii')
  body.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  const original = chunks(bytes).filter((c) => !ownChunk(c))
  const end = original.pop()!
  return Buffer.concat([signature, ...original.map((c) => c.raw), chunk, end.raw])
}
