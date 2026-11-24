import {
  MAX_REFERENCES,
  REFERENCE_FEE,
  REFERENCE_LABELS,
  type PreciseReference,
} from '../generation/references'

export const ATTACHMENT_LABELS = { discussion: '仅讨论', ...REFERENCE_LABELS } as const
export interface ChatAttachment {
  imageName: string
  label: string
  purpose: keyof typeof ATTACHMENT_LABELS
}
export function validateAttachments(items: unknown): asserts items is ChatAttachment[] {
  if (
    !Array.isArray(items) ||
    items.length > MAX_REFERENCES ||
    items.some(
      (item) =>
        !item ||
        typeof item.imageName !== 'string' ||
        !/^ref-[a-f0-9]{64}\.png$/.test(item.imageName) ||
        typeof item.label !== 'string' ||
        !item.label.trim() ||
        item.label.length > 120 ||
        !Object.hasOwn(ATTACHMENT_LABELS, item.purpose),
    ) ||
    new Set(items.map((item) => item.imageName)).size !== items.length
  ) {
    throw new Error('聊天附件无效，请选择最多 4 张不同的图片')
  }
}
export function attachmentReferenceNotice(items: ChatAttachment[] = []) {
  const count = items.filter((image) => image.purpose !== 'discussion').length
  return count
    ? '采纳后会将本轮指定的 ' +
        count +
        ' 张附图用于生成，每张参考每张输出 +' +
        REFERENCE_FEE +
        ' Anlas。'
    : ''
}
/** Returns a merged reference list only when this request explicitly assigns generation roles. */
export function generationReferences(
  current: PreciseReference[],
  attachments: ChatAttachment[],
  model: string,
) {
  if (attachments.every((image) => image.purpose === 'discussion')) {
    return undefined
  }
  if (model !== 'v4.5') {
    throw new Error('角色与画风参考需要 V4.5 Full，请切换模型或将附图用途改为仅讨论')
  }
  const next = current.map((image) => ({ ...image }))
  for (const { imageName, purpose } of attachments) {
    if (purpose === 'discussion') {
      continue
    }
    const existing = next.find((image) => image.imageName === imageName)
    if (existing) {
      existing.mode = purpose
    } else {
      next.push({ imageName, mode: purpose, strength: 1, fidelity: 1 })
    }
  }
  if (next.length > MAX_REFERENCES) {
    throw new Error('合并后超过 4 张生成参考，请先在配置中移除不需要的参考图')
  }
  return next
}
