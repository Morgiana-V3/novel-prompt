import type { NaiImage } from '../../../shared/images/types'
import { legacyImageDir, libraryImagePath, listLibraryImages } from './library'

export const IMAGE_SCHEME = 'np-img'

export function imageDir(): string {
  return legacyImageDir()
}

/** 只接受图库目录下的 png 文件名，防止路径穿越 */
export function imagePath(name: string): string | null {
  return libraryImagePath(name)
}

/* ---------- 图库 ---------- */

export function listImages(limit = 120): NaiImage[] {
  return listLibraryImages(limit)
}
