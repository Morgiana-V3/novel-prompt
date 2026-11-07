<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { anlasOutcomeText } from '@shared/generation/pricing'
import type { PageEventMetadata, PageExecutionEvent } from '@shared/workspace/events'
import type { PageMessage, PageVersion } from '@shared/workspace/model'

const props = defineProps<{
  message: PageMessage
  event: PageEventMetadata
  versions: PageVersion[]
  adoptedVersionId: string
  editingPrompt: boolean
  label: (id: string) => string
  time: (at: number) => string
}>()
const emit = defineEmits<{ view: [id: string] }>()
const execution = computed(() => (props.event.type === 'execution' ? props.event : null))
const versionsById = computed(() => new Map(props.versions.map((version) => [version.id, version])))
const resultIds = computed(() => execution.value?.versionIds ?? [props.message.versionId])
const primaryResultId = computed(() => resultIds.value.at(-1))
const primaryVersion = computed(() => {
  const id = primaryResultId.value
  return id ? versionsById.value.get(id) : undefined
})
const previewFailed = ref(false)
watch(
  () => primaryVersion.value?.image?.url,
  () => {
    previewFailed.value = false
  },
)
const kindLabels: Record<PageExecutionEvent['kind'], string> = {
  generate: '生成',
  inpaint: '局部重绘',
  upscale: '放大',
  outpaint: '扩图',
  enhance: '精修',
}
const title = computed(() => {
  const event = execution.value
  if (!event) {
    return '已保存生成结果'
  }
  const kind = kindLabels[event.kind]
  if (event.status === 'failed') {
    return `${kind}未完成`
  }
  if (event.stopped) {
    return `${kind}已停止`
  }
  return event.status === 'partial' ? `${kind}部分完成` : `${kind}完成`
})
const alerts = computed(() => {
  const event = execution.value
  const messages: string[] = []
  if (!event) {
    return messages
  }
  if (event.error) {
    messages.push(event.error)
  }
  if (event.stopped && !messages.includes(event.stopped)) {
    messages.push(event.stopped)
  }
  if (event.status === 'failed' && !messages.length) {
    messages.push('本次执行未完成，未保存新图片。')
  }
  if (
    event.billing.status === 'unknown' ||
    (event.billing.status === 'known' && event.billing.anlasDelta === undefined)
  ) {
    messages.push('费用未知：本次余额变化尚未核对。')
  }
  if (!messages.length && event.severity !== 'info') {
    messages.push(props.message.text)
  }
  return messages
})
const billingText = computed(() => {
  const billing = execution.value?.billing
  if (!billing || billing.status === 'not-run') {
    return ''
  }
  const text = anlasOutcomeText(billing)
  return billing.remainingAnlas === undefined
    ? text
    : `${text} · 当时剩余 ${billing.remainingAnlas} Anlas`
})
</script>

<template>
  <section
    class="pw-execution-message"
    :class="event.severity"
    :aria-label="title"
  >
    <div class="pw-execution-heading">
      <b>{{ title }}</b>
      <time>{{ time(message.createdAt) }}</time>
    </div>
    <div
      v-if="resultIds.length"
      class="pw-execution-result"
    >
      <button
        v-if="primaryVersion?.image && !primaryVersion.image.missing && !previewFailed"
        class="pw-execution-preview"
        :disabled="editingPrompt"
        :aria-label="`查看 ${label(primaryVersion.id)}`"
        @click="emit('view', primaryVersion.id)"
      >
        <img
          :src="primaryVersion.image.url"
          alt="生成结果预览"
          loading="lazy"
          @error="previewFailed = true"
        />
      </button>
      <div>
        <p>
          已保存 {{ resultIds.length }} 张
          <span v-if="execution"> / 计划 {{ execution.requestedCount }} 张</span>
        </p>
        <button
          v-if="primaryResultId"
          class="pw-execution-view"
          :disabled="editingPrompt || !primaryVersion"
          @click="emit('view', primaryResultId)"
        >
          查看 {{ label(primaryResultId) }}
        </button>
        <small v-if="primaryResultId === adoptedVersionId">当前蓝本</small>
        <small v-else-if="!primaryVersion">结果版本已不可用</small>
      </div>
    </div>
    <div
      v-if="alerts.length"
      class="pw-execution-alerts"
      role="status"
    >
      <p
        v-for="alert in alerts"
        :key="alert"
      >
        {{ alert }}
      </p>
    </div>
    <p
      v-if="execution?.billing.status === 'not-run'"
      class="pw-execution-note"
    >
      未进入生图服务，无费用观测。
    </p>
    <details class="pw-execution-details">
      <summary class="disclosure">执行详情</summary>
      <template v-if="execution">
        <p>
          来源：<button
            :disabled="editingPrompt || !versionsById.has(execution.sourceVersionId)"
            @click="emit('view', execution.sourceVersionId)"
          >
            {{ label(execution.sourceVersionId) }}
          </button>
        </p>
        <p>
          执行后蓝本：<button
            :disabled="editingPrompt || !versionsById.has(execution.adoptedVersionId)"
            @click="emit('view', execution.adoptedVersionId)"
          >
            {{ label(execution.adoptedVersionId) }}
          </button>
        </p>
        <p v-if="billingText">{{ billingText }}</p>
        <small v-if="billingText">费用为本次执行前后的余额观测，不是当前余额。</small>
      </template>
      <div
        v-if="resultIds.length > 1"
        class="pw-execution-candidates"
      >
        <button
          v-for="id in resultIds"
          :key="id"
          :disabled="editingPrompt || !versionsById.has(id)"
          @click="emit('view', id)"
        >
          查看 {{ label(id) }}
        </button>
      </div>
      <p class="pw-execution-original">{{ message.text }}</p>
    </details>
  </section>
</template>

<style scoped>
.pw-execution-message {
  padding: 12px;
  font-size: 11px;
  color: var(--text2);
  background: var(--panel);
  border: 1px solid var(--line2);
  border-radius: 10px;
  overflow-wrap: anywhere;
}

.pw-execution-message.warning {
  border-color: var(--alias);
}

.pw-execution-message.error {
  border-color: var(--bad);
}

.pw-execution-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pw-execution-heading b {
  font-size: 12px;
}

.pw-execution-heading time {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}

.pw-execution-result {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
}

.pw-execution-preview {
  flex-shrink: 0;
  width: 54px;
  height: 54px;
  padding: 0;
  overflow: hidden;
  border-radius: 6px;
}

.pw-execution-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pw-execution-result p,
.pw-execution-alerts p,
.pw-execution-details p {
  margin: 4px 0;
}

.pw-execution-result small {
  margin-left: 6px;
  font-size: 10px;
  color: var(--muted);
}

.pw-execution-view,
.pw-execution-details button {
  color: var(--pink-deep);
  text-align: left;
}

.pw-execution-alerts {
  margin-top: 9px;
  padding: 7px 9px;
  white-space: pre-wrap;
  color: var(--alias);
  background: var(--bg);
  border-radius: 6px;
}

.pw-execution-message.error .pw-execution-alerts {
  color: var(--bad);
}

.pw-execution-note {
  margin: 8px 0 0;
  color: var(--muted);
}

.pw-execution-details {
  margin-top: 9px;
  font-size: 10px;
  color: var(--muted);
}

.pw-execution-details summary {
  cursor: pointer;
}

.pw-execution-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  margin-top: 8px;
}

.pw-execution-original {
  white-space: pre-wrap;
}
</style>
