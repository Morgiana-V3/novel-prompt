<script setup lang="ts">
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import { computed } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import { toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { saveSettings, settingsState } from './state'

/** 任务完成提醒：窗口不在前台时，生图、AI 等需要等待的任务结束后发系统通知 */
const enabled = computed(() => settingsState.settings?.notifyOnComplete !== false)

async function set(next: boolean) {
  try {
    await saveSettings({ notifyOnComplete: next })
    toast(next ? '已开启任务完成提醒' : '已关闭任务完成提醒')
  } catch (error) {
    toast(cleanErr(error))
  }
}
</script>

<template>
  <div
    class="card"
    style="--d: 200ms"
  >
    <div class="card-head">
      <span class="card-icon"><Icon name="bell" /></span>
      <div>
        <h2>任务完成提醒</h2>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-field full">
        <div
          v-seg-indicator
          class="seg"
        >
          <button
            :class="{ on: !enabled }"
            @click="set(false)"
          >
            关闭
          </button>
          <button
            :class="{ on: enabled }"
            @click="set(true)"
          >
            开启
          </button>
        </div>
        <span class="muted small"
          >窗口不在前台时，生图、局部重绘、智能优化、画面推测、AI
          讨论、图片识别等任务完成或失败后发系统通知，并闪烁任务栏图标；3
          秒内结束的任务不提醒。</span
        >
      </div>
    </div>
  </div>
</template>
