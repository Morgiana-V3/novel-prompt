import type { InjectionKey } from 'vue'
import type { UpdateInfo } from '@shared/types'

export const prepareUpdateKey: InjectionKey<() => Promise<void>> = Symbol('prepare-update')

export function updateLabel(info: UpdateInfo | null): string {
  if (!info) return '版本与更新'
  if (info.stage === 'checking') return '正在检查更新…'
  if (info.stage === 'downloading') return `正在下载 ${info.latest} · ${Math.floor(info.percent ?? 0)}%`
  if (info.stage === 'ready') return `${info.latest} 已就绪`
  if (info.stage === 'installing') return '正在安装更新…'
  if (info.error) return info.newer ? `更新 ${info.latest} 失败` : `当前 v${info.current} · 检查失败`
  if (info.newer) return `发现新版本 ${info.latest}`
  return info.checkedAt ? `已是最新 v${info.current}` : `当前 v${info.current}`
}
