import sharp from 'sharp'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { PreciseReference } from '../../../shared/generation/references'
import { imagePath } from '../images/access'
import { storeReferenceImage } from '../images/library'

const MAX_BYTES = 40 * 1024 * 1024
const options = { limitInputPixels: 24_000_000 }

async function sourceBytes(source: Uint8Array | string): Promise<Buffer> {
  if (typeof source === 'string') {
    const path = imagePath(source)
    if (!path || (await stat(path)).size > MAX_BYTES) {
      throw new Error('参考图已缺失或超过 40 MB，请重新选择')
    }
    const bytes = await readFile(path)
    if (
      /^ref-[a-f0-9]{64}\.png$/.test(source) &&
      source !== 'ref-' + createHash('sha256').update(bytes).digest('hex') + '.png'
    ) {
      throw new Error('参考图内容已变化，请重新选择')
    }
    return bytes
  }
  if (!(source instanceof Uint8Array) || !source.byteLength || source.byteLength > MAX_BYTES) {
    throw new Error('请选择 40 MB 以内的参考图')
  }
  return Buffer.from(source)
}

async function normalize(bytes: Buffer) {
  const image = sharp(bytes, options)
  const { format } = await image.metadata()
  if (!['png', 'jpeg', 'webp'].includes(format ?? '')) {
    throw new Error('请选择 PNG、JPEG 或 WebP 图片')
  }
  return image
    .autoOrient()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

export async function importReferenceImage(source: Uint8Array | string) {
  const bytes = await sourceBytes(source)
  if (typeof source === 'string' && /^ref-[a-f0-9]{64}\.png$/.test(source)) {
    return source
  }
  return storeReferenceImage(await normalize(bytes))
}

export async function prepareReferences(references: PreciseReference[]): Promise<string[]> {
  const images: string[] = []
  for (const reference of references) {
    reference.imageName = await importReferenceImage(reference.imageName)
    const bytes = await sourceBytes(reference.imageName)
    const image = sharp(bytes, options)
    const { width, height } = await image.metadata()
    const ratio = width / height
    let size = [1472, 1472]
    if (ratio > Math.sqrt(1.5)) {
      size = [1536, 1024]
    } else if (ratio < Math.sqrt(2 / 3)) {
      size = [1024, 1536]
    }
    const padded = await image
      .flatten({ background: '#000' })
      .resize(size[0], size[1], { fit: 'contain', background: '#000' })
      .png()
      .toBuffer()
    images.push(padded.toString('base64'))
  }
  return images
}
