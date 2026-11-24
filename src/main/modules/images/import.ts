import sharp from 'sharp'
import { IMAGE_IMPORT_LIMIT } from '../../../shared/images/import'

/** Keep original PNG bytes so embedded generation metadata remains available. */
export async function importImageAsPng(bytes: Uint8Array, maxPixels = 24_000_000): Promise<Buffer> {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > IMAGE_IMPORT_LIMIT) {
    throw new Error('请选择不超过 25 MB 的 PNG、JPEG 或 WebP 图片')
  }
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const image = sharp(source, { limitInputPixels: maxPixels })
  const metadata = await image.metadata()
  if (
    !metadata.width ||
    !metadata.height ||
    !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')
  ) {
    throw new Error('请选择有效的 PNG、JPEG 或 WebP 图片')
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new Error('请选择静态图片')
  }
  if (metadata.format === 'png') {
    await image.stats()
    return source
  }
  return image.autoOrient().png().toBuffer()
}
