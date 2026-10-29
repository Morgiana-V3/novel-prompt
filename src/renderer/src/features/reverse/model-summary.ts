import type { ReverseModel, ReverseStatus } from '@shared/reverse/types'

const descriptions: Record<ReverseModel, { name: string; purpose: string }> = {
  wd: { name: 'WD', purpose: '识别服装、动作、场景和角色标签' },
  k3: { name: 'Kaloscope 3', purpose: '推荐画师，比较试图与参考图的风格' },
  k2: { name: 'Kaloscope 2', purpose: '补充另一组画师候选' },
  pixai: { name: 'PixAI', purpose: '识别角色，补充较新的角色标签' },
}

export function summarizeReverseModels(
  status: ReverseStatus | undefined,
  selection: ReverseModel[],
) {
  return (['wd', 'k3', 'k2', 'pixai'] as const)
    .filter((id) => selection.includes(id))
    .map((id) => {
      const files = status?.models.filter((file) => file.model === id) ?? []
      return {
        id,
        ...descriptions[id],
        ready: files.length > 0 && files.every((file) => file.ready),
        partial: files.some((file) => file.ready) && files.some((file) => !file.ready),
        bytes: files.reduce((total, file) => total + file.bytes, 0),
        missingBytes: files.reduce((total, file) => total + (file.ready ? 0 : file.bytes), 0),
      }
    })
}

export function modelSize(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.ceil(bytes / 1024 ** 2)} MB`
}
