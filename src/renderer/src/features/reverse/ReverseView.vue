<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ReverseModel, ReverseResult, ReverseStatus } from '@shared/reverse/types'
import { shellState } from '../../shared/state/shell'
import { toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { pushHistory } from '../prompts/actions'
import { promptState, type CharDraft } from '../prompts/state'
import Icon from '../../shared/ui/Icon.vue'
import ReverseModels from './ReverseModels.vue'
import ReverseCharacters from './ReverseCharacters.vue'
import ReverseReference from './ReverseReference.vue'
import ReverseTrials from './ReverseTrials.vue'
import { loadReversePreferences, saveReversePreferences } from './preferences'

const status = ref<ReverseStatus>()
const preferences = loadReversePreferences()
const selection = ref<ReverseModel[]>(preferences.models)
const threshold = ref(preferences.tagThreshold)
const characterThreshold = ref(preferences.characterThreshold)
const pixaiCharacterThreshold = ref(preferences.pixaiCharacterThreshold)
const artistThreshold = ref(preferences.artistThreshold)
watch(
  [selection, threshold, characterThreshold, pixaiCharacterThreshold, artistThreshold],
  () => {
    try {
      saveReversePreferences({
        models: [...selection.value],
        tagThreshold: threshold.value,
        characterThreshold: characterThreshold.value,
        pixaiCharacterThreshold: pixaiCharacterThreshold.value,
        artistThreshold: artistThreshold.value,
      })
    } catch (e) {
      error.value = `设置保存失败：${cleanErr(e)}`
    }
  },
  { deep: true },
)
const pane = ref<'recognition' | 'characters' | 'trials'>('recognition')
const filteredTags = computed(() =>
  (result.value?.tags ?? []).filter((tag) => tag.score >= threshold.value),
)
const selectedReady = computed(
  () =>
    !!status.value &&
    status.value.models.filter((m) => selection.value.includes(m.model)).every((m) => m.ready),
)
watch(
  selection,
  () => {
    refresh().catch((e) => {
      error.value = cleanErr(e)
    })
  },
  { deep: true },
)
watch(threshold, () => {
  if (result.value) {
    content.value = filteredTags.value.map((t) => t.name).join(', ')
  }
})
const error = ref('')
const image = ref<File>()
const imageUrl = ref('')
const picker = ref<HTMLInputElement>()
const result = ref<ReverseResult>()
const content = ref('')
const style = ref('')
const characterText = ref('')
const characters = ref<CharDraft[]>([])
const croppedResult = ref<ReverseResult>()
const reference = ref<InstanceType<typeof ReverseReference>>()
const cropEnabled = ref(false)
const hasCrop = ref(false)
const cropModels = computed<ReverseModel[]>(() =>
  selection.value.filter((model) => model === 'wd' || model === 'pixai'),
)
const cropReady = computed(
  () =>
    cropModels.value.length > 0 &&
    !!status.value &&
    status.value.models.filter((m) => cropModels.value.includes(m.model)).every((m) => m.ready),
)
const characterResult = computed(() => croppedResult.value ?? result.value)
const characterUsesPixai = computed(
  () =>
    characterResult.value?.characterModel === 'pixai' ||
    (!characterResult.value && selection.value.includes('pixai')),
)
const activeCharacterThreshold = computed({
  get: () => (characterUsesPixai.value ? pixaiCharacterThreshold.value : characterThreshold.value),
  set: (value: number) => {
    if (characterUsesPixai.value) {
      pixaiCharacterThreshold.value = value
    } else {
      characterThreshold.value = value
    }
  },
})
const promptContent = computed(() =>
  [characterText.value.trim(), content.value.trim()].filter(Boolean).join(', '),
)
const running = ref(false)
const actionBusy = ref(false)
const modelsOpen = ref(false)
const modelOperation = computed(() =>
  ['downloading', 'verifying'].includes(status.value?.phase ?? ''),
)
const notices = computed(() =>
  (result.value?.warnings ?? [])
    .filter((warning) => !warning.startsWith('画师候选'))
    .map((warning) =>
      warning.startsWith('检测到多个人物') ? '多个人物：请手动分配角色标签。' : warning,
    ),
)
watch(
  () => shellState.tab,
  (tab) => {
    if (tab !== 'reverse') {
      modelsOpen.value = false
    }
  },
)
const busy = computed(
  () =>
    running.value ||
    actionBusy.value ||
    ['downloading', 'verifying', 'running'].includes(status.value?.phase ?? ''),
)
const combined = computed(() =>
  [style.value.trim(), promptContent.value.trim()].filter(Boolean).join(', '),
)
const progress = computed(() =>
  status.value?.totalBytes
    ? Math.min(100, (status.value.completedBytes / status.value.totalBytes) * 100)
    : 0,
)
const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`
let timer: ReturnType<typeof setInterval>
let polling = false
let cancelRequested = false

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
onMounted(() => {
  refresh().catch((e) => {
    error.value = cleanErr(e)
  })
  timer = setInterval(() => {
    if (shellState.tab === 'reverse' || busy.value) {
      refresh().catch((e) => {
        error.value = cleanErr(e)
      })
    }
  }, 900)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  URL.revokeObjectURL(imageUrl.value)
})

async function manage(action: 'install' | 'import' | 'cancel' | 'remove') {
  error.value = ''
  actionBusy.value = true
  try {
    if (action === 'install') {
      status.value = await window.api.reverseInstall([...selection.value])
    } else if (action === 'import') {
      status.value = await window.api.reverseImport([...selection.value])
    } else if (action === 'cancel') {
      cancelRequested = true
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

function select(file?: File) {
  if (!file || busy.value) {
    return
  }
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 25 * 1024 * 1024
  ) {
    error.value = '请选择不超过 25 MB 的 PNG、JPEG 或 WebP 图片'
    return
  }
  URL.revokeObjectURL(imageUrl.value)
  image.value = file
  imageUrl.value = URL.createObjectURL(file)
  pane.value = 'recognition'
  result.value = undefined
  content.value = ''
  style.value = ''
  characterText.value = ''
  characters.value = []
  croppedResult.value = undefined
  cropEnabled.value = false
  hasCrop.value = false
  error.value = ''
}
function drop(event: DragEvent) {
  select(event.dataTransfer?.files[0])
}
function picked(event: Event) {
  const input = event.target as HTMLInputElement
  select(input.files?.[0])
  input.value = ''
}
async function analyze() {
  if (!image.value || busy.value) {
    return
  }
  error.value = ''
  running.value = true
  cancelRequested = false
  result.value = undefined
  content.value = ''
  style.value = ''
  croppedResult.value = undefined
  characterText.value = ''
  characters.value = []
  try {
    const bytes = new Uint8Array(await image.value.arrayBuffer())
    if (cancelRequested) {
      throw new Error('已取消识别')
    }
    result.value = await window.api.reverseAnalyze(bytes, [...selection.value])
    content.value = filteredTags.value.map((tag) => tag.name).join(', ')
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
    await refresh()
  }
}
async function analyzeCrop() {
  if (!reference.value || !hasCrop.value || busy.value || !cropReady.value) {
    return
  }
  error.value = ''
  running.value = true
  cancelRequested = false
  croppedResult.value = undefined
  try {
    const bytes = await reference.value.bytes()
    if (cancelRequested) {
      throw new Error('已取消识别')
    }
    croppedResult.value = await window.api.reverseAnalyze(bytes, [...cropModels.value])
    pane.value = 'characters'
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    running.value = false
    await refresh()
  }
}
function cropSelected(selected: boolean) {
  hasCrop.value = selected
  croppedResult.value = undefined
}
function clearCrop() {
  reference.value?.clear()
  hasCrop.value = false
  croppedResult.value = undefined
  cropEnabled.value = false
}
function isArtistEntry(entry: string, name: string) {
  // Compare complete tags; artist:a must not match artist:ab.
  const plain = entry.trim().replace(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)::(.+)::$/, '$1')
  return plain.trim() === `artist:${name}`
}
function hasArtist(name: string) {
  return style.value.split(',').some((entry) => isArtistEntry(entry, name))
}
function toggleArtist(name: string) {
  const tag = `artist:${name}`
  if (hasArtist(name)) {
    style.value = style.value
      .split(',')
      .filter((entry) => !isArtistEntry(entry, name))
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(', ')
  } else {
    style.value = [style.value.trim(), tag].filter(Boolean).join(', ')
  }
}
async function copy(text: string) {
  try {
    await window.api.copy(text)
    toast('已复制')
  } catch (e) {
    error.value = cleanErr(e)
  }
}
function prepareUpdate() {
  if (busy.value) {
    throw new Error('请先停止图片识别或组合试图，再重启更新')
  }
}
defineExpose({ prepareUpdate })

function adopt() {
  pushHistory('图片反推写入前')
  promptState.prompt = combined.value
  if (characters.value.length) {
    promptState.characters = characters.value.map((role) => ({ ...role }))
  }
  shellState.tab = 'compare'
  toast('已写入提示词，原内容可在历史中找回')
}
async function source(url: string) {
  try {
    await window.api.openWebUrl(url)
  } catch (e) {
    error.value = cleanErr(e)
  }
}
</script>

<template>
  <section
    class="reverse-view"
    @dragenter.stop.prevent
    @dragover.stop.prevent
    @dragleave.stop.prevent
    @drop.stop.prevent="drop"
  >
    <div class="reverse-toolbar">
      <input
        ref="picker"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="picked"
      />
      <button
        class="btn small"
        :disabled="busy"
        @click="picker?.click()"
      >
        <Icon
          name="image"
          :size="15"
        />{{ image ? '更换图片' : '选择图片' }}
      </button>
      <button
        class="btn small primary reverse-run"
        :disabled="!image || !selectedReady || busy"
        @click="analyze"
      >
        <Icon
          name="search"
          :size="14"
        />{{ running ? '识别中…' : '开始识别' }}
      </button>
      <button
        v-if="busy"
        class="btn small"
        :disabled="actionBusy"
        @click="manage('cancel')"
      >
        {{ running || status?.phase === 'running' ? '取消识别' : '取消下载' }}
      </button>
      <span
        class="reverse-stage"
        role="status"
        >{{ busy ? status?.message : '' }}</span
      >
      <button
        class="btn small ghost reverse-model-toggle"
        aria-label="模型管理"
        :title="selectedReady ? '本地模型已就绪' : '管理本地模型'"
        @click="modelsOpen = true"
      >
        <span
          class="model-dot"
          :class="{ ready: selectedReady }"
        ></span
        >模型<Icon
          name="sliders"
          :size="14"
        />
      </button>
    </div>

    <div class="reverse-options">
      <label
        v-for="option in [
          ['wd', '内容 / 角色'],
          ['k2', 'K2 画师'],
          ['k3', 'K3 画师 / 评分'],
          ['pixai', 'PixAI 角色'],
        ] as const"
        :key="option[0]"
      >
        <input
          v-model="selection"
          type="checkbox"
          :value="option[0]"
          :disabled="busy || (selection.length === 1 && selection.includes(option[0]))"
        />{{ option[1] }}
      </label>
      <div class="seg">
        <button
          :class="{ on: pane === 'recognition' }"
          @click="pane = 'recognition'"
        >
          识别结果
        </button>
        <button
          :class="{ on: pane === 'characters' }"
          @click="pane = 'characters'"
        >
          角色识别
        </button>
        <button
          :class="{ on: pane === 'trials' }"
          :disabled="!result"
          @click="pane = 'trials'"
        >
          画师组合
        </button>
      </div>
    </div>
    <div
      v-if="status && !selectedReady && !modelOperation"
      class="reverse-setup"
    >
      <span>所选功能需下载本地模型 · {{ size(status.totalBytes) }}</span>
      <button
        class="btn small"
        :disabled="busy"
        @click="manage('install')"
      >
        下载并启用
      </button>
    </div>
    <div
      v-if="modelOperation && status"
      class="reverse-download"
    >
      <progress
        :value="progress"
        max="100"
        aria-label="模型下载进度"
      /><span>{{ size(status.completedBytes) }} / {{ size(status.totalBytes) }}</span>
    </div>
    <p
      v-if="error || status?.phase === 'error'"
      class="reverse-error"
      role="alert"
    >
      {{ error || status?.message }}
    </p>

    <div
      class="reverse-workspace"
      :class="{ 'trials-open': pane === 'trials' }"
    >
      <section class="reverse-input">
        <div class="reverse-panel-head">
          <span>参考图</span
          ><span
            v-if="image"
            class="reverse-file"
            :title="image.name"
            >{{ image.name }}</span
          >
        </div>
        <ReverseReference
          ref="reference"
          :url="imageUrl"
          :file="image"
          :disabled="busy"
          :crop-enabled="cropEnabled && pane === 'characters'"
          @choose="picker?.click()"
          @selected="cropSelected"
        />
        <div
          v-if="image && pane === 'characters'"
          class="reverse-crop-tools"
        >
          <button
            class="btn small"
            :disabled="busy"
            :aria-pressed="cropEnabled"
            @click="cropEnabled = !cropEnabled"
          >
            框选人物
          </button>
          <button
            class="btn small"
            :disabled="busy || !hasCrop || !cropReady"
            @click="analyzeCrop"
          >
            识别选区
          </button>
          <button
            class="btn small"
            :disabled="busy || (!hasCrop && !croppedResult)"
            @click="clearCrop"
          >
            返回全图
          </button>
          <span v-if="!cropReady">{{
            cropModels.length ? '请下载所选的角色模型' : '请勾选内容 / 角色或 PixAI 角色'
          }}</span>
          <span v-else-if="cropEnabled && !hasCrop">在图上拖动框选</span>
        </div>
      </section>

      <section
        v-show="pane === 'recognition'"
        class="reverse-output"
        :data-ready="!!result"
        aria-label="反推结果"
      >
        <div class="reverse-content-panel">
          <div class="reverse-panel-head">
            <label for="reverse-content">基础提示词</label
            ><label
              v-if="result?.tags.length"
              class="reverse-threshold"
              >阈值<input
                v-model.number="threshold"
                aria-label="基础标签阈值"
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                :disabled="busy" /></label
            ><span
              v-if="result"
              class="reverse-meta"
              >{{ filteredTags.length }} 个标签 · {{ result.seconds.toFixed(1) }} 秒</span
            ><button
              class="icon-btn sm"
              :disabled="!content.trim()"
              title="复制基础词"
              aria-label="复制基础词"
              @click="copy(content)"
            >
              <Icon
                name="copy"
                :size="14"
              />
            </button>
          </div>
          <textarea
            id="reverse-content"
            v-model="content"
            :disabled="!result || busy"
            rows="5"
            placeholder="识别后显示基础提示词"
            spellcheck="false"
          />
          <p
            v-for="notice in notices"
            :key="notice"
            class="reverse-notice"
          >
            {{ notice }}
          </p>
        </div>
        <div class="reverse-style-panel">
          <div class="reverse-panel-head">
            <span>画师候选</span
            ><label
              v-if="result?.artists.length"
              class="reverse-threshold"
              >阈值<input
                v-model.number="artistThreshold"
                aria-label="画师候选阈值"
                type="number"
                min="0"
                max="1"
                step="0.001"
                :disabled="busy" /></label
            ><span
              class="reverse-meta"
              title="候选表示风格接近，不代表原作者；排名分数不是画师权重。"
              >排名分数</span
            >
          </div>
          <div
            v-if="result"
            class="reverse-artists"
          >
            <div
              v-for="group in result.artists"
              :key="group.model"
              class="reverse-artist-group"
            >
              <div class="reverse-model-name">{{ group.model }}</div>
              <ol>
                <li
                  v-for="tag in group.tags
                    .filter((tag) => tag.score >= artistThreshold)
                    .slice(0, 10)"
                  :key="tag.name"
                >
                  <button
                    class="reverse-artist"
                    :disabled="busy"
                    :class="{ selected: hasArtist(tag.name) }"
                    :aria-pressed="hasArtist(tag.name)"
                    :title="`${hasArtist(tag.name) ? '移除' : '加入'} artist:${tag.name}`"
                    @click="toggleArtist(tag.name)"
                  >
                    <span>{{ tag.name }}</span
                    ><small>{{ tag.score.toFixed(3) }}</small
                    ><Icon
                      :name="hasArtist(tag.name) ? 'check' : 'plus'"
                      :size="12"
                    />
                  </button>
                </li>
              </ol>
            </div>
          </div>
          <div
            v-else
            class="reverse-artists-empty"
          >
            {{ running ? '识别中…' : '暂无画师候选' }}
          </div>
          <div class="reverse-style-editor">
            <div class="reverse-panel-head">
              <label for="reverse-style">画师串</label
              ><button
                class="icon-btn sm"
                :disabled="!style"
                title="清空画师串"
                aria-label="清空画师串"
                @click="style = ''"
              >
                <Icon
                  name="x"
                  :size="14"
                /></button
              ><button
                class="icon-btn sm"
                :disabled="!style.trim()"
                title="复制画师串"
                aria-label="复制画师串"
                @click="copy(style)"
              >
                <Icon
                  name="copy"
                  :size="14"
                />
              </button>
            </div>
            <textarea
              id="reverse-style"
              v-model="style"
              :disabled="!result || busy"
              rows="2"
              placeholder="点击候选添加，可直接编辑"
              spellcheck="false"
            />
          </div>
        </div>
        <footer class="reverse-result-actions">
          <button
            class="btn small"
            :disabled="!combined"
            @click="copy(combined)"
          >
            复制组合</button
          ><button
            class="btn small primary"
            :disabled="!combined"
            title="替换当前主提示词，原内容保存到历史"
            @click="adopt"
          >
            写入主提示词<Icon
              name="arrow"
              :size="14"
            />
          </button>
        </footer>
      </section>
      <ReverseCharacters
        v-show="pane === 'characters'"
        v-model:threshold="activeCharacterThreshold"
        v-model:base="characterText"
        v-model:characters="characters"
        :result="characterResult"
        :cropped="!!croppedResult"
        :busy="busy"
        :general-threshold="threshold"
        @adopt="adopt"
      />
      <ReverseTrials
        v-if="result"
        v-show="pane === 'trials'"
        :key="imageUrl"
        :result="result"
        :content="promptContent"
        :characters="characters"
        :style-prompt="style"
        :image="image"
        :disabled="running || actionBusy || modelOperation"
      />
    </div>
    <ReverseModels
      v-if="modelsOpen"
      :status="status"
      :selection="selection"
      :busy="busy"
      :error="error"
      @close="modelsOpen = false"
      @manage="manage"
      @source="source"
    />
  </section>
</template>

<style scoped>
.reverse-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  overflow: auto;
}

.reverse-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  flex-shrink: 0;
}

.reverse-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}

.reverse-options label {
  display: flex;
  gap: 5px;
  align-items: center;
}

.reverse-options .seg {
  margin-left: auto;
}

.reverse-threshold {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text2);
}

.reverse-threshold input {
  width: 62px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 3px;
  color: var(--text);
}

.reverse-stage {
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reverse-model-toggle {
  margin-left: auto;
  flex-shrink: 0;
}

.model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
}

.model-dot.ready {
  background: var(--ok);
}

.reverse-setup {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 8px 12px;
  border-radius: 6px;
}

.reverse-setup .btn {
  margin-left: auto;
}

.reverse-download {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text2);
}

progress {
  flex: 1;
  height: 5px;
  accent-color: var(--pink-deep);
}

.reverse-workspace {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(380px, 1.35fr);
  gap: 16px;
  flex: 1;
  min-height: 480px;
}

.reverse-workspace.trials-open {
  align-items: start;
}

.trials-open .reverse-input {
  position: sticky;
  top: 0;
  height: calc(100vh - 185px);
  min-height: 280px;
}

.reverse-input,
.reverse-content-panel,
.reverse-style-panel {
  border: 1px solid var(--line2);
  border-radius: 8px;
  background: var(--bg);
  min-width: 0;
  overflow: hidden;
}

.reverse-input {
  display: flex;
  flex-direction: column;
}

.reverse-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.reverse-file,
.reverse-meta {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}

.reverse-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}

.reverse-panel-head .icon-btn:first-of-type {
  margin-left: auto;
}

.reverse-meta + .icon-btn {
  margin-left: 0 !important;
}

.reverse-crop-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border-top: 1px solid var(--line);
}

.reverse-crop-tools span {
  color: var(--text2);
  font-size: 11px;
}

.reverse-output {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0;
}

.reverse-content-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 150px;
}

.reverse-output textarea {
  display: block;
  width: 100%;
  padding: 12px;
  color: var(--text);
  background: var(--bg);
  border: 0;
  resize: none;
  font: 12px/1.7 var(--mono);
  border-radius: 0;
}

.reverse-output textarea:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--pink-line);
}

.reverse-output textarea:disabled {
  color: var(--muted);
  opacity: 1;
  background: var(--bg);
}

#reverse-content {
  flex: 1;
  min-height: 100px;
}

.reverse-style-panel {
  flex: 1.4;
  max-height: 350px;
  display: flex;
  flex-direction: column;
  min-height: 294px;
}

.reverse-artists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: auto;
  flex: 1;
}

.reverse-artist-group {
  padding: 10px 12px;
  min-width: 0;
}

.reverse-artist-group + .reverse-artist-group {
  border-left: 1px solid var(--line);
}

.reverse-model-name {
  font-size: 11px;
  color: var(--text2);
  margin-bottom: 5px;
}

.reverse-artists ol {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: artist;
}

.reverse-artists li {
  display: flex;
  align-items: center;
  counter-increment: artist;
}

.reverse-artists li::before {
  content: counter(artist);
  width: 15px;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
}

.reverse-artist {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 4px;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}

.reverse-artist span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reverse-artist small {
  color: var(--muted);
  font-size: 10px;
}

.reverse-artist > .icon {
  color: var(--muted);
  flex-shrink: 0;
}

.reverse-artist:hover,
.reverse-artist.selected {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.reverse-artists-empty {
  display: grid;
  place-items: center;
  flex: 1;
  min-height: 150px;
  color: var(--muted);
  font-size: 12px;
}

.reverse-style-editor {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
}

.reverse-style-editor .reverse-panel-head {
  min-height: 32px;
  border: 0;
  padding-block: 3px;
}

#reverse-style {
  min-height: 65px;
  padding-top: 4px;
}

.reverse-notice {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  color: var(--alias);
  font-size: 11px;
  line-height: 1.5;
}

.reverse-result-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.reverse-error {
  margin: 0;
  color: var(--bad);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

@media (width <= 1000px) {
  .reverse-view {
    padding: 12px;
  }

  .reverse-workspace {
    grid-template-columns: minmax(200px, 0.8fr) minmax(340px, 1.2fr);
    gap: 12px;
  }
}

@media (width <= 820px) {
  .reverse-workspace {
    grid-template-columns: 1fr;
    flex: none;
  }

  .reverse-input {
    min-height: 280px;
  }

  .reverse-output {
    min-height: 500px;
  }

  .reverse-stage {
    display: none;
  }
}
</style>
