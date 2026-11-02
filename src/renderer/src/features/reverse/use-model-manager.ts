import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { ReverseModel, ReverseStatus } from '@shared/reverse/types'
import { cleanErr } from '../../shared/lib/format'
interface ModelManagerHost {
  status: Ref<ReverseStatus | undefined>
  selection: Ref<ReverseModel[]>
  error: Ref<string>
  actionBusy: Ref<boolean>
  cancelRequested: Ref<boolean>
  modelsOpen: Ref<boolean>
  shouldPoll: () => boolean
}
export function useModelManager(host: ModelManagerHost) {
  const { status, selection, error, actionBusy, cancelRequested, modelsOpen } = host
  let polling = false
  let timer: ReturnType<typeof setInterval>
  async function refresh() {
    if (polling) {
      return
    }
    polling = true
    try {
      status.value = await window.api.reverseStatus([...selection.value])
    } catch (e) {
      error.value = cleanErr(e)
    } finally {
      polling = false
    }
  }
  async function manage(action: 'install' | 'import' | 'cancel' | 'remove') {
    error.value = ''
    actionBusy.value = true
    if (action !== 'cancel') {
      cancelRequested.value = false
    }
    try {
      if (action === 'install') {
        status.value = await window.api.reverseInstall([...selection.value])
      } else if (action === 'import') {
        status.value = await window.api.reverseImport([...selection.value])
      } else if (action === 'cancel') {
        cancelRequested.value = true
        await window.api.reverseCancel()
      } else {
        await window.api.reverseRemove([...selection.value])
        modelsOpen.value = false
      }
      await refresh()
    } catch (e) {
      error.value = cleanErr(e)
    } finally {
      actionBusy.value = false
    }
  }

  onMounted(() => {
    void refresh().catch((candidate) => {
      error.value = cleanErr(candidate)
    })
    timer = setInterval(() => {
      if (host.shouldPoll()) {
        void refresh().catch((candidate) => {
          error.value = cleanErr(candidate)
        })
      }
    }, 900)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return { refresh, manage }
}
