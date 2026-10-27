import type { Settings } from '@shared/settings/types'
import type { UpdateInfo } from '@shared/updates/types'
import { reactive } from 'vue'

export const settingsState = reactive({
  settings: null as Settings | null,

  /** 切到设置页后滚动到的区块 id */
  settingsAnchor: '',

  /** 版本检查结果（发现新版时侧栏提示） */
  update: null as UpdateInfo | null,

  /** 用户关掉了这次的更新提示 */
  updateDismissed: false,
})

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settingsState.settings = await window.api.saveSettings(patch)
}

/* ---------- 版本检查 ---------- */

/** 进度事件和 IPC 回包可能交错，只接受最新状态。 */
export function receiveUpdate(info: UpdateInfo | null): void {
  if (!info || (info.revision ?? 0) < (settingsState.update?.revision ?? 0)) {
    return
  }
  if (
    info.latest !== settingsState.update?.latest ||
    (info.stage === 'ready' && settingsState.update?.stage !== 'ready')
  ) {
    settingsState.updateDismissed = false
  }
  settingsState.update = info
}

/** 启动时静默检查；force 用于用户主动重试，下载与缓存策略由主进程负责。 */
export async function checkUpdate(force = false): Promise<void> {
  try {
    receiveUpdate(await window.api.checkUpdate(force))
    // 新版本号变了就重新允许提示（用户之前关掉的是旧的那次提示）
    if (force) {
      settingsState.updateDismissed = false
    }
  } catch {
    /* 忽略：检查更新失败不影响任何功能 */
  }
}

export function dismissUpdate(): void {
  settingsState.updateDismissed = true
}
