<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { state, cleanErr, toast } from '../store'
import { prepareUpdateKey } from '../updates'
import { taskState } from '../tasks'
import { taskIsActive } from '@shared/tasks'

const prepare = inject(prepareUpdateKey)
const pending = ref(false)
const stage = computed(() => state.update?.stage)
const busy = computed(() => taskState.tasks.some(taskIsActive))
const disabled = computed(() => pending.value || ['checking', 'downloading', 'installing'].includes(stage.value ?? '') || stage.value === 'ready' && busy.value)
const label = computed(() => !state.update?.autoSupported ? '去下载'
  : stage.value === 'ready' ? (busy.value ? '任务结束后更新' : '重启并更新')
    : stage.value === 'downloading' ? `下载中 ${Math.floor(state.update.percent ?? 0)}%`
      : stage.value === 'installing' ? '正在更新…' : stage.value === 'error' ? '重试下载' : '下载更新')
async function act() {
  if (disabled.value) return
  pending.value = true
  try {
    if (!state.update?.autoSupported) await window.api.openUpdatePage(state.update?.url ?? '')
    else if (stage.value === 'ready') {
      if (!prepare) throw new Error('界面尚未准备好，请稍后重试')
      await prepare()
      await window.api.installUpdate()
    } else await window.api.downloadUpdate()
  } catch (e) { toast(cleanErr(e)) }
  finally { pending.value = false }
}
</script>

<template>
  <button v-if="state.update?.newer" class="btn accent small" :disabled="disabled" @click="act">{{ label }}</button>
</template>
