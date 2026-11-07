import type { Ref } from 'vue'
import type { DesktopState } from '@shared/contracts/desktop'
import { promptState } from '../../features/prompts/public/draft'
import { imageState } from '../../features/generation/public'
import { settingsState } from '../../features/settings/state'
import { tabSummaries } from '../../features/creation/public/navigation'
import { shellState } from '../../shared/state/shell'
import { cleanErr } from '../../shared/lib/format'
import type { DesktopHost } from './types'

/** Owns one renderer session's revision token without retaining another copy of its state. */
export function createDesktopSnapshot(host: DesktopHost, frontend: Ref<DesktopState['frontend']>) {
  const { confirmation, creationPanel, workspaceView, generateView, aiView } = host
  const desktopSession = crypto.randomUUID()
  let desktopRevision = 0
  let desktopKey = ''
  function desktopSnapshot(): DesktopState {
    const blockers: string[] = []
    if (confirmation.value) {
      blockers.push('等待用户确认付费授权')
    }
    try {
      generateView.value?.prepareUpdate()
    } catch (error) {
      blockers.push(cleanErr(error))
    }
    if (workspaceView.value?.isCreating()) {
      blockers.push('正在新建图片精修项目')
    }
    const value = {
      tab: shellState.tab,
      creationPanel: creationPanel.value,
      creationAi: aiView.value?.desktopState(),
      draft: {
        base: promptState.prompt,
        negative: promptState.negative,
        characters: promptState.characters.map((character) => ({ ...character })),
      },
      creationTabs: tabSummaries(),
      model: settingsState.settings?.naiVersion ?? 'v5',
      image: imageState.currentImage ? { ...imageState.currentImage } : null,
      workspace: workspaceView.value?.desktopState() ?? null,
      blockers,
      frontend: frontend.value ? { ...frontend.value } : null,
    }
    const key = JSON.stringify(value)
    if (key !== desktopKey) {
      desktopKey = key
      desktopRevision++
    }
    // Vue refs may expose nested proxies; publish only the plain, already serialized snapshot.
    return { token: `${desktopSession}:${desktopRevision}`, ...JSON.parse(key) }
  }

  return desktopSnapshot
}
