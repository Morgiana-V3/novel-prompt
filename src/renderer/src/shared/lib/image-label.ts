import type { NaiImage } from '@shared/images/types'

/** Keep meaningful imported filenames; generated IDs remain internal file identifiers. */
export function imageLabel(image: Pick<NaiImage, 'name' | 'createdAt'>): string {
  const stem = image.name.replace(/\.[^.]+$/, '')
  const generated =
    /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{24,})$/i.test(stem)
  if (image.name && !generated) {
    return image.name
  }
  const date = new Date(image.createdAt)
  if (!image.createdAt || !Number.isFinite(date.getTime())) {
    return '图片'
  }
  return `图片 · ${date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
}
