import {
  MAX_REFERENCES,
  checkReferences,
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
    throw new Error(`聊天附件无效，本应用每条消息最多附加 ${MAX_REFERENCES} 张不同图片`)
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
  usingVibes = false,
) {
  if (attachments.every((image) => image.purpose === 'discussion')) {
    return undefined
  }
  if (usingVibes) {
    throw new Error('当前配置使用 Vibe Transfer，请将本轮附图改为仅讨论，或先移除 Vibe')
  }
  const next = current.map((image) => ({ ...image }))
  for (const { imageName, purpose } of attachments) {
    if (purpose === 'discussion') {
      continue
    }
    const existing = next.find((image) => image.imageName === imageName)
    if (existing) {
      if (existing.mode !== purpose) {
        delete existing.preferSameOutfit
      }
      existing.mode = purpose
    } else {
      next.push({ imageName, mode: purpose, strength: 1, fidelity: 1 })
    }
  }
  if (next.length > MAX_REFERENCES) {
    throw new Error(`合并后超过本应用 ${MAX_REFERENCES} 张精确参考上限，请先移除不需要的参考图`)
  }
  checkReferences(next, model)
  return next
}
