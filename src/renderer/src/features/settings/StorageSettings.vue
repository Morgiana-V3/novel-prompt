<script setup lang="ts">
import { watch, ref } from 'vue'
import type { StorageInfo } from '@shared/settings/storage'
import { cleanErr } from '../../shared/lib/format'
import { shellState } from '../../shared/state/shell'
const info = ref<StorageInfo | null>(null)
const selected = ref('')
const error = ref('')
const busy = ref(false)
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`
async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    busy.value = false
  }
}
watch(
  () => shellState.tab,
  async (tab) => {
    if (tab === 'settings') {
      await run(async () => {
        info.value = await window.api.storageInfo()
      })
    }
  },
  { immediate: true },
)
const choose = () =>
  run(async () => {
    selected.value = (await window.api.storageChoose()) || ''
  })
const schedule = () =>
  run(async () => {
    info.value = await window.api.storageSchedule(selected.value)
    selected.value = ''
  })
const cancel = () =>
  run(async () => {
    info.value = await window.api.storageCancel()
  })
const open = () => run(() => window.api.storageOpen())
</script>

<template>
  <section
    class="card storage-settings"
    aria-label="存储与数据"
  >
    <div class="card-head">
      <div>
        <h2>存储与数据</h2>
        <p>一个目录，保存你的图片、模型、Tag、收藏与工作台项目。</p>
      </div>
    </div>
    <template v-if="info">
      <div class="storage-location">
        <span>当前数据目录 · {{ size(info.bytes) }}</span
        ><code>{{ info.path }}</code>
      </div>
      <div class="row">
        <button
          class="btn ghost small"
          :disabled="busy"
          @click="open"
        >
          打开目录
        </button>
        <button
          class="btn small"
          :disabled="busy || !!info.pending"
          @click="choose"
        >
          更改数据目录
        </button>
      </div>
      <div
        v-if="selected"
        class="storage-plan"
      >
        <b>迁移到新目录</b><code>{{ selected }}</code>
        <p>
          下次启动时复制并校验全部数据，成功后自动切换。模型较大时启动会需要一些时间。原目录保留，不会自动删除。
        </p>
        <div class="row">
          <button
            class="btn accent small"
            :disabled="busy"
            @click="schedule"
          >
            确认，下次启动迁移</button
          ><button
            class="btn ghost small"
            :disabled="busy"
            @click="selected = ''"
          >
            取消
          </button>
        </div>
      </div>
      <div
        v-if="info.pending"
        class="storage-plan"
      >
        <b>已安排迁移</b><code>{{ info.pending }}</code>
        <p>保存当前编辑并完全退出软件，下次启动自动执行。若有外部 Agent 连接，请先断开连接。</p>
        <button
          class="btn ghost small"
          :disabled="busy"
          @click="cancel"
        >
          取消迁移计划
        </button>
      </div>
      <p v-if="info.previous">
        迁移已完成。原目录仍保留在
        {{ info.previous }}；确认新数据正常后，可在文件管理器中清理原业务数据。
      </p>
      <p
        v-if="info.error"
        class="error-box"
        role="alert"
      >
        {{ info.error }}
      </p>
    </template>
    <p v-if="busy">正在检查数据目录…</p>
    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.storage-settings {
  display: grid;
  gap: 14px;
}

.storage-settings p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.storage-location,
.storage-plan {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
}

.storage-location span {
  color: var(--muted);
  font-size: 12px;
}

.storage-settings code {
  overflow-wrap: anywhere;
  font-size: 13px;
}
</style>
