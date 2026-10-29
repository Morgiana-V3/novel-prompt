<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ReverseModel, ReverseStatus } from '@shared/reverse/types'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  status?: ReverseStatus
  selection: ReverseModel[]
  busy: boolean
  error: string
}>()
const descriptions: Record<ReverseModel, { name: string; purpose: string }> = {
  wd: { name: 'WD', purpose: '识别服装、动作、场景和角色标签' },
  k3: { name: 'Kaloscope 3', purpose: '推荐画师，比较试图与参考图的风格' },
  k2: { name: 'Kaloscope 2', purpose: '补充另一组画师候选' },
  pixai: { name: 'PixAI', purpose: '识别角色，补充较新的角色标签' },
}
const files = computed(
  () => props.status?.models.filter((file) => props.selection.includes(file.model)) ?? [],
)
const models = computed(() =>
  (['wd', 'k3', 'k2', 'pixai'] as const)
    .filter((id) => props.selection.includes(id))
    .map((id) => {
      const entries = files.value.filter((file) => file.model === id)
      return {
        id,
        ...descriptions[id],
        ready: entries.length > 0 && entries.every((file) => file.ready),
        partial: entries.some((file) => file.ready) && entries.some((file) => !file.ready),
        bytes: entries.reduce((total, file) => total + file.bytes, 0),
      }
    }),
)
const allReady = computed(
  () => models.value.length > 0 && models.value.every((model) => model.ready),
)
const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`
const emit = defineEmits<{
  close: []
  manage: [action: 'install' | 'import' | 'remove' | 'cancel']
  source: [url: string]
}>()
const dialog = ref<HTMLDialogElement>()
const removeConfirm = ref(false)
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="reverse-model-dialog"
      aria-labelledby="reverse-model-title"
      @cancel.prevent="emit('close')"
      @click="$event.target === $event.currentTarget && emit('close')"
      @keydown.stop
    >
      <header>
        <h3 id="reverse-model-title">本地模型</h3>
        <button
          class="icon-btn sm"
          aria-label="关闭模型管理"
          @click="emit('close')"
        >
          <Icon
            name="x"
            :size="16"
          />
        </button>
      </header>
      <div
        v-if="status"
        class="model-files"
      >
        <div
          v-for="model in models"
          :key="model.id"
        >
          <Icon
            :name="model.ready ? 'check' : 'download'"
            :size="14"
          />
          <div class="model-description">
            <strong>{{ model.name }}</strong>
            <span>{{ model.purpose }}</span>
          </div>
          <div class="model-state">
            <span>{{ model.ready ? '已下载' : model.partial ? '待补全' : '待下载' }}</span>
            <span>{{ size(model.bytes) }}</span>
          </div>
        </div>
      </div>
      <p
        v-else
        class="muted"
      >
        正在读取模型状态…
      </p>
      <details v-if="status">
        <summary>存储位置、来源与手动导入</summary>
        <p class="model-path">{{ status.directory }}</p>
        <p>手动导入时，请从以下来源下载对应版本的模型及配套文件。</p>
        <div
          v-for="file in files"
          :key="file.name"
          class="model-file-source"
        >
          <span>{{ file.name }}</span>
          <button
            class="model-source"
            @click="emit('source', file.source)"
          >
            {{ file.license }}
          </button>
        </div>
        <button
          class="btn small"
          :disabled="busy"
          @click="emit('manage', 'import')"
        >
          导入模型
        </button>
      </details>
      <p
        v-if="error || status?.phase === 'error'"
        class="model-error"
        role="alert"
      >
        {{ error || status?.message }}
      </p>
      <footer>
        <button
          v-if="busy"
          class="btn small"
          @click="emit('manage', 'cancel')"
        >
          取消操作
        </button>
        <button
          class="btn small"
          :disabled="busy || !status || !models.length"
          @click="emit('manage', 'install')"
        >
          {{ allReady ? '检查并修复' : '下载所选模型' }}
        </button>
        <button
          v-if="status?.models.some((m) => selection.includes(m.model) && m.ready)"
          class="btn small"
          :disabled="busy"
          @click="removeConfirm = !removeConfirm"
        >
          删除所选模型
        </button>
      </footer>
      <div
        v-if="removeConfirm"
        class="model-delete"
      >
        <span>删除后需重新下载才能识别。</span
        ><button
          class="btn small danger"
          :disabled="busy"
          @click="emit('manage', 'remove')"
        >
          确认删除
        </button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.reverse-model-dialog {
  width: min(480px, calc(100vw - 40px));
  max-height: calc(100vh - 80px);
  margin: auto;
  padding: 20px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
}

.reverse-model-dialog::backdrop {
  background: var(--scrim);
}

header,
footer,
.model-delete {
  display: flex;
  align-items: center;
  gap: 8px;
}

header {
  justify-content: space-between;
}

h3 {
  font-size: 15px;
  margin: 0;
}

p,
details {
  font-size: 12px;
  line-height: 1.7;
}

.muted,
details {
  color: var(--text2);
}

.model-files {
  border-block: 1px solid var(--line);
  padding: 8px 0;
  margin: 16px 0;
}

.model-files > div {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 56px;
  font-size: 12px;
}

.model-description,
.model-state {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-description {
  flex: 1;
  min-width: 0;
}

.model-description span,
.model-state {
  color: var(--text2);
}

.model-state {
  text-align: right;
  flex-shrink: 0;
  font-size: 11px;
}

.model-file-source {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.model-source {
  margin-left: auto;
  background: none;
  border: 0;
  color: var(--text2);
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
}

.model-path,
.model-error {
  overflow-wrap: anywhere;
}

.model-error {
  color: var(--bad);
}

summary {
  cursor: pointer;
}

footer {
  flex-wrap: wrap;
  margin-top: 18px;
}

.model-delete {
  justify-content: space-between;
  margin-top: 12px;
  font-size: 12px;
}
</style>
