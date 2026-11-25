<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  MAX_VIBES,
  VIBE_ENCODE_FEE,
  vibeGenerationFee,
  type VibeCacheStatus,
  type VibeReference,
} from '@shared/generation/vibes'
import type { NaiImage } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import { cleanErr } from '../../../shared/lib/format'
import { toast } from '../../../shared/lib/notifications'
import { detachLeaving } from '../../../shared/lib/list-motion'
import { vFadeImg } from '../../../shared/lib/fade-image'
import Icon from '../../../shared/ui/Icon.vue'
import ReferenceGalleryDialog from './ReferenceGalleryDialog.vue'

const props = defineProps<{
  entries: VibeReference[]
  version: NaiVersion
  current?: NaiImage | null
  conflict?: boolean
  disabled?: boolean
  allowSwitch?: boolean
}>()
const emit = defineEmits<{ change: [entries: VibeReference[]]; switchModel: [] }>()
const strengthHint = '调高更接近参考图的配色和画风，调低则给提示词更多发挥空间。'
const informationHint = '调高可提取更多纹理细节，调低则主要保留整体构图。'
const fileInput = ref<HTMLInputElement>()
const gallery = ref(false)
const busy = ref(false)
const error = ref('')
const statusCache = ref<Record<string, VibeCacheStatus>>({})
let epoch = 0
let active = true
const fee = computed(() => vibeGenerationFee(props.entries.length))
const canAdd = computed(
  () =>
    props.version === 'v4.5' &&
    !props.conflict &&
    !props.disabled &&
    !busy.value &&
    props.entries.length < MAX_VIBES,
)

function cacheKey(entry: Pick<VibeReference, 'imageName' | 'information'>): string {
  return `${entry.imageName}:${entry.information}`
}

function statusOf(
  entry: Pick<VibeReference, 'imageName' | 'information'>,
): VibeCacheStatus | undefined {
  return statusCache.value[cacheKey(entry)]
}

const cacheSignature = computed(() => props.entries.map(cacheKey).join('|'))

async function refresh() {
  const ticket = ++epoch
  const snapshot = props.entries.map((vibe) => ({ ...vibe }))
  if (!snapshot.length) {
    return
  }
  try {
    const result = await window.api.naiVibeStatuses(snapshot)
    if (ticket === epoch && active) {
      const next = { ...statusCache.value }
      snapshot.forEach((entry, index) => {
        if (result[index]) {
          next[cacheKey(entry)] = result[index]
        }
      })
      statusCache.value = next
    }
  } catch (cause) {
    if (ticket === epoch && active) {
      error.value = cleanErr(cause)
    }
  }
}

watch(cacheSignature, refresh, { immediate: true })
onBeforeUnmount(() => {
  active = false
})

async function add(source: File | string) {
  if (!canAdd.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (source instanceof File && source.size > 40 * 1024 * 1024) {
      throw new Error('请选择 40 MB 以内的 PNG、JPEG 或 WebP 图片')
    }
    const imageName = await window.api.naiImportReference(
      typeof source === 'string' ? source : new Uint8Array(await source.arrayBuffer()),
    )
    if (!active || props.version !== 'v4.5' || props.conflict || props.disabled) {
      return
    }
    if (props.entries.some((entry) => entry.imageName === imageName)) {
      throw new Error('这张图已经添加')
    }
    emit('change', [...props.entries, { imageName, strength: 0.6, information: 1 }])
    gallery.value = false
  } catch (cause) {
    error.value = cleanErr(cause)
  } finally {
    busy.value = false
  }
}

async function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) {
    await add(file)
  }
}

function update(index: number, patch: Partial<VibeReference>) {
  emit(
    'change',
    props.entries.map((entry, candidate) => (candidate === index ? { ...entry, ...patch } : entry)),
  )
}

function changeAmount(index: number, field: 'strength' | 'information', event: Event) {
  update(index, { [field]: Number((event.target as HTMLInputElement).value) })
}

async function encode(index: number) {
  const entry = props.entries[index]
  if (!entry || busy.value || props.disabled || props.conflict || props.version !== 'v4.5') {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await window.api.naiVibeEncode({ ...entry })
    if (result.cached) {
      toast('已使用缓存编码')
    } else if (result.charge === null) {
      toast('编码已保存，本次费用待核对')
    } else {
      toast('编码已保存 · Anlas 变化 ' + -result.charge)
    }
  } catch (cause) {
    error.value = cleanErr(cause)
    toast(error.value)
  } finally {
    await refresh()
    busy.value = false
  }
}
</script>

<template>
  <section
    class="vibes"
    aria-label="Vibe Transfer"
  >
    <div
      v-if="version !== 'v4.5'"
      class="vibe-callout"
    >
      <Icon
        name="info"
        :size="14"
      />
      <span>Vibe Transfer 仅支持 V4.5 Full 模型。</span>
      <button
        v-if="allowSwitch"
        class="btn small ml-auto"
        :disabled="disabled || busy"
        @click="emit('switchModel')"
      >
        切到 V4.5
      </button>
    </div>
    <p
      v-else-if="conflict"
      class="vibe-callout"
    >
      <Icon
        name="info"
        :size="14"
      />
      <span>当前已启用精确参考，请先移除精确参考再使用 Vibe Transfer。</span>
    </p>
    <template v-else>
      <div class="vibe-actions">
        <button
          class="btn small"
          :disabled="!canAdd"
          @click="fileInput?.click()"
        >
          <Icon
            name="upload"
            :size="14"
          />
          上传图片
        </button>
        <button
          class="btn small"
          :disabled="!canAdd"
          @click="gallery = true"
        >
          <Icon
            name="folder"
            :size="14"
          />
          从图库选
        </button>
        <button
          v-if="current"
          class="btn small"
          :disabled="!canAdd"
          @click="add(current.name)"
        >
          <Icon
            name="image"
            :size="14"
          />
          用当前图片
        </button>
      </div>
    </template>
    <input
      ref="fileInput"
      hidden
      type="file"
      accept="image/png,image/jpeg,image/webp"
      @change="picked"
    />
    <ReferenceGalleryDialog
      v-if="gallery"
      :disabled="!canAdd"
      :busy="busy"
      :error="error"
      @select="add($event.name)"
      @close="gallery = false"
    />
    <TransitionGroup
      v-if="entries.length"
      tag="div"
      name="list"
      class="vibe-list list-motion"
      @before-leave="detachLeaving"
    >
      <article
        v-for="(entry, index) in entries"
        :key="entry.imageName"
        class="vibe-card"
      >
        <img
          v-fade-img
          class="vibe-preview"
          :src="'np-img://img/' + encodeURIComponent(entry.imageName)"
          alt="Vibe 参考图"
        />
        <div class="vibe-card-head">
          <span
            v-if="statusOf(entry) === 'ready'"
            class="pill ok"
            title="当前图片和信息提取量已有编码，可直接复用。"
          >
            <Icon
              name="check"
              :size="11"
            />已编码
          </span>
          <span
            v-else-if="statusOf(entry) === 'uncertain'"
            class="pill alias"
          >
            <i></i>待核对
          </span>
          <button
            v-else-if="statusOf(entry) === 'missing'"
            class="btn small vibe-encode-btn"
            title="按当前信息提取量编码。同图同值可复用，只调强度无需重新编码。"
            :disabled="busy || disabled || conflict || version !== 'v4.5'"
            @click="encode(index)"
          >
            <Icon
              name="sparkle"
              :size="12"
            />
            编码 · {{ VIBE_ENCODE_FEE }} Anlas
          </button>
          <span
            v-else
            class="pill"
            >检查中…</span
          >
          <button
            class="vibe-remove"
            title="移除 Vibe"
            :disabled="disabled || busy"
            :aria-label="'移除第 ' + (index + 1) + ' 张 Vibe'"
            @click="
              emit(
                'change',
                entries.filter((_, candidate) => index !== candidate),
              )
            "
          >
            <Icon
              name="x"
              :size="14"
            />
          </button>
        </div>
        <div class="vibe-levels">
          <label>
            <span :title="strengthHint">强度</span>
            <input
              type="range"
              :title="strengthHint"
              :aria-label="'Vibe ' + (index + 1) + ' 强度'"
              min="0"
              max="1"
              step="0.05"
              :value="entry.strength"
              :disabled="disabled || busy"
              :style="{ '--progress': entry.strength * 100 + '%' }"
              @input="changeAmount(index, 'strength', $event)"
            />
            <output :title="strengthHint">{{ entry.strength.toFixed(2) }}</output>
          </label>
          <label>
            <span :title="informationHint">信息提取量</span>
            <input
              type="range"
              :title="informationHint"
              :aria-label="'Vibe ' + (index + 1) + ' 信息提取量'"
              min="0"
              max="1"
              step="0.05"
              :value="entry.information"
              :disabled="disabled || busy"
              :style="{ '--progress': entry.information * 100 + '%' }"
              @input="changeAmount(index, 'information', $event)"
            />
            <output :title="informationHint">{{ entry.information.toFixed(2) }}</output>
          </label>
        </div>
      </article>
    </TransitionGroup>
    <p
      v-if="fee"
      class="vibe-fee"
    >
      <Icon
        name="info"
        :size="13"
      />
      <span>当前参考数量每张输出另计 {{ fee }} Anlas。</span>
    </p>
    <p
      v-if="error"
      class="vibe-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.vibes {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 4px 0 2px;
}

.vibe-actions,
.vibe-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.vibe-actions {
  flex-wrap: wrap;
}

.vibe-actions button {
  height: 28px;
  line-height: 18px;
  gap: 6px;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
}

.vibe-callout {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0;
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--alias) 22%, var(--line));
  border-radius: 10px;
  background: var(--alias-soft);
  color: var(--alias);
  font-size: 12px;
  line-height: 1.45;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.vibe-list {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 248px), 1fr));
}

.vibe-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 6px 10px;
  padding: 9px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  background: var(--panel);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.vibe-card:hover {
  border-color: var(--pink-line);
  background: var(--bg);
}

.vibe-preview {
  grid-row: span 2;
  width: 64px;
  height: 80px;
  align-self: center;
  object-fit: contain;
  border-radius: 8px;
  background: var(--hover);
  border: 1px solid var(--line);
}

.vibe-card-head {
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.vibe-encode-btn {
  height: 24px;
  padding: 0 9px;
  font-size: 11px;
  border-color: var(--pink-line);
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.vibe-encode-btn:hover:not(:disabled) {
  border-color: var(--pink);
  background: color-mix(in srgb, var(--pink-soft) 72%, var(--pink-line));
}

.vibe-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: var(--muted);
  flex-shrink: 0;
  margin-left: auto;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.vibe-remove:hover:not(:disabled) {
  background: var(--bad-soft);
  color: var(--bad);
}

.vibe-remove:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.vibe-levels {
  display: grid;
  align-content: center;
  gap: 2px;
}

.vibe-levels label {
  display: grid;
  grid-template-columns: 5em minmax(24px, 1fr) 2.8em;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  font-size: 11px;
}

.vibe-levels label > span {
  justify-self: start;
}

.vibe-levels output {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.vibe-levels input {
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 18px;
  cursor: pointer;
  background: transparent;
}

.vibe-levels input::-webkit-slider-runnable-track {
  height: 3.5px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--pink) var(--progress), var(--line2) var(--progress));
}

.vibe-levels input::-webkit-slider-thumb {
  appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -3.75px;
  background: var(--pink);
  border: 1.5px solid #fff;
  box-shadow: 0 1px 3px rgb(20 20 30 / 22%);
  border-radius: 50%;
  transition: transform var(--dur-fast) var(--ease-out);
}

.vibe-levels input:hover:not(:disabled)::-webkit-slider-thumb {
  transform: scale(1.18);
}

.vibe-levels input:active:not(:disabled)::-webkit-slider-thumb {
  transform: scale(0.95);
}

.vibe-fee {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11.5px;
  color: var(--text2);
  animation: fade-in var(--dur-base) var(--ease-out);
}

.vibe-fee .icon {
  color: var(--muted);
}

.vibe-error {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 11.5px;
  animation: alert-in var(--dur-slow) var(--ease-out);
}
</style>
