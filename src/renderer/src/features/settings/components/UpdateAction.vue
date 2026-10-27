<script setup lang="ts">
import { settingsState } from '../state'
import { computed, inject, ref } from 'vue'
import { cleanErr } from '../../../shared/lib/format'
import { toast } from '../../../shared/lib/notifications'
import { prepareUpdateKey } from '../updates'
import { taskState } from '../../../shared/state/tasks'
import { taskIsActive } from '@shared/tasks/model'

const prepare = inject(prepareUpdateKey)
const pending = ref(false)
const stage = computed(() => settingsState.update?.stage)
const busy = computed(() => taskState.tasks.some(taskIsActive))
const disabled = computed(
  () =>
    pending.value ||
    ['checking', 'downloading', 'installing'].includes(stage.value ?? '') ||
    (stage.value === 'ready' && busy.value),
)
const label = computed(() => {
  if (!settingsState.update?.autoSupported) {
    return '去下载' as const
  }
  if (stage.value === 'ready') {
    if (busy.value) {
      return '任务结束后更新' as const
    }
    return '重启并更新' as const
  }
  if (stage.value === 'downloading') {
    return `下载中 ${Math.floor(settingsState.update.percent ?? 0)}%`
  }
  if (stage.value === 'installing') {
    return '正在更新…' as const
  }
  if (stage.value === 'error') {
    return '重试下载' as const
  }
  return '下载更新' as const
})
async function act() {
  if (disabled.value) {
    return
  }
  pending.value = true
  try {
    if (!settingsState.update?.autoSupported) {
      await window.api.openUpdatePage(settingsState.update?.url ?? '')
    } else if (stage.value === 'ready') {
      if (!prepare) {
        throw new Error('界面尚未准备好，请稍后重试')
      }
      await prepare()
      await window.api.installUpdate()
    } else {
      await window.api.downloadUpdate()
    }
  } catch (error) {
    toast(cleanErr(error))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <button
    v-if="settingsState.update?.newer"
    class="btn accent small"
    :disabled="disabled"
    @click="act"
  >
    {{ label }}
  </button>
</template>
