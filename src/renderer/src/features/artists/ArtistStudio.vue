<script setup lang="ts">
import { backdropCloser } from '../../shared/lib/dialog-motion'
import { detachLeaving } from '../../shared/lib/list-motion'
import { computed, ref } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import RunButton from '../../shared/ui/RunButton.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import { shellState } from '../../shared/state/shell'
import { reportError, toast } from '../../shared/lib/notifications'
import type { NaiImage } from '@shared/images/types'
import { artistString, useArtistStudio } from './studio'
import ArtistBlueprintPicker from './ArtistBlueprintPicker.vue'
import ArtistCatalog from './ArtistCatalog.vue'

const studio = useArtistStudio()
const { state, selected, busy, trials, persistenceError } = studio
/** 已出结果（成功或失败）的候选数，作为生成按钮的确定进度 */
const finishedTrials = computed(
  () => trials.trials.filter((trial) => trial.state === 'done' || trial.state === 'error').length,
)
const pasteDialog = ref<HTMLDialogElement>()
const seedDialog = ref<HTMLDialogElement>()
const catalog = ref<InstanceType<typeof ArtistCatalog>>()
const blueprints = ref<InstanceType<typeof ArtistBlueprintPicker>>()
const pasted = ref('')
const pasteError = ref('')
const artistName = ref('')
const viewer = ref<NaiImage>()
const minimumUpperBound = computed(() =>
  Math.max(0.05, ...selected.value.artists.map((artist) => artist.weight)),
)
function setWeightUpperBound(event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  if (!busy.value && Number.isFinite(value) && value >= minimumUpperBound.value) {
    state.weightRange.max = value
  } else if (!busy.value) {
    toast(`滑杆上限不能低于 ${minimumUpperBound.value}`)
  }
  input.value = String(state.weightRange.max)
}
const baselineImage = computed(() => studio.result(state.baseline))
const candidateImage = computed(() =>
  studio.hasChanges.value ? studio.result(selected.value) : undefined,
)
const changes = computed(() => {
  const before = state.baseline.artists.filter((artist) => artist.enabled)
  const after = selected.value.artists.filter((artist) => artist.enabled)
  const changed = after.flatMap((artist) => {
    const previous = before.find((entry) => entry.name === artist.name)
    if (!previous) {
      return [`加入 ${artist.name} · ${artist.weight}`]
    }
    if (previous.weight !== artist.weight) {
      return [`${artist.name}  ${previous.weight} → ${artist.weight}`]
    }
    return []
  })
  for (const artist of before) {
    if (!after.some((entry) => entry.name === artist.name)) {
      changed.push(`停用 ${artist.name}`)
    }
  }
  return changed
})

function openPaste() {
  pasted.value = artistString(selected.value.artists)
  pasteError.value = ''
  pasteDialog.value?.showModal()
}
function applyPaste() {
  try {
    selected.value.artists = studio.parseArtists(pasted.value)
    pasteDialog.value?.close()
  } catch (error) {
    pasteError.value = error instanceof Error ? error.message : String(error)
  }
}
function addArtist() {
  const name = artistName.value.trim().replace(/^artist:\s*/i, '')
  if (!name || busy.value) {
    return
  }
  try {
    studio.addArtist(name)
    artistName.value = ''
  } catch (error) {
    reportError(error)
  }
}
function updateWeight(id: string, value: number) {
  if (!Number.isFinite(value) || busy.value) {
    return
  }
  const artist = selected.value.artists.find((entry) => entry.id === id)
  if (artist) {
    artist.weight = Math.round(value * 1000) / 1000
  }
}
function weightInput(event: Event, id: string) {
  const input = event.target as HTMLInputElement
  updateWeight(id, input.valueAsNumber)
}
async function copy() {
  try {
    await navigator.clipboard.writeText(artistString(selected.value.artists))
    toast('画师串已复制')
  } catch (error) {
    reportError(error)
  }
}
function randomSeed() {
  state.context.params.seed = crypto.getRandomValues(new Uint32Array(1))[0]
}
function openSeed() {
  seedDialog.value?.showModal()
}
function closeSeed() {
  seedDialog.value?.close()
}
const pasteBackdrop = backdropCloser(() => pasteDialog.value?.close())
const seedBackdrop = backdropCloser(() => closeSeed())
function addFromCatalog(name: string) {
  try {
    studio.addArtist(name)
  } catch (error) {
    reportError(error)
  }
}
</script>

<template>
  <div class="artist-studio">
    <div class="artist-studio-body">
      <section class="artist-editor">
        <header class="artist-section-heading">
          <h3>画师与权重</h3>
          <button
            class="artist-text-button"
            :disabled="busy"
            @click="openPaste"
          >
            粘贴画师串
          </button>
        </header>
        <div class="artist-editor-actions">
          <button
            class="btn"
            @click="catalog?.open()"
          >
            <Icon
              name="book"
              :size="14"
            />画师图鉴
          </button>
          <button
            class="artist-text-button"
            aria-label="打开图鉴收藏"
            @click="catalog?.open('favorites')"
          >
            <Icon
              name="star"
              :size="14"
            />图鉴收藏 {{ state.favoriteArtists.length }}
          </button>
        </div>
        <div class="artist-range-settings">
          <label title="所有画师共用刻度；修改上限不会改变权重">
            滑杆上限
            <input
              type="number"
              aria-label="画师滑杆上限"
              :min="minimumUpperBound"
              step="any"
              :value="state.weightRange.max"
              :disabled="busy"
              @change="setWeightUpperBound"
            />
          </label>
          <span
            v-if="state.weightRange.min < 0"
            title="所有画师共用此下限"
            >下限 {{ state.weightRange.min }}</span
          >
        </div>
        <TransitionGroup
          tag="div"
          name="list"
          class="artist-editor-list list-motion"
          @before-leave="detachLeaving"
        >
          <article
            v-for="artist in selected.artists"
            :key="artist.id"
            :class="['artist-entry', { muted: !artist.enabled }]"
          >
            <div class="artist-entry-top">
              <label class="artist-toggle"
                ><input
                  v-model="artist.enabled"
                  type="checkbox"
                  :disabled="busy"
                  :aria-label="`启用 ${artist.name}`"
                /><span :title="artist.name">{{ artist.name }}</span></label
              >
              <button
                class="artist-delete"
                :disabled="busy"
                :aria-label="`删除画师 ${artist.name}`"
                title="删除画师"
                @click="studio.removeArtist(artist.id)"
              >
                <Icon
                  name="x"
                  :size="14"
                />
              </button>
            </div>
            <div class="artist-weight-row">
              <input
                type="range"
                :min="state.weightRange.min"
                :max="state.weightRange.max"
                step="0.05"
                :value="artist.weight"
                :disabled="busy || !artist.enabled"
                :aria-label="`${artist.name} 权重滑杆`"
                @input="weightInput($event, artist.id)"
              />
              <input
                type="number"
                title="可直接输入权重，超出刻度时会统一扩展所有滑杆"
                step="0.05"
                :value="artist.weight"
                :disabled="busy || !artist.enabled"
                :aria-label="`${artist.name} 权重`"
                @change="weightInput($event, artist.id)"
              />
            </div>
          </article>
          <p
            v-if="!selected.artists.length"
            key="empty"
            class="artist-empty-list"
          >
            当前是无画师对照。可以加入画师，或直接查看内容提示词的效果。
          </p>
        </TransitionGroup>
        <form
          class="artist-add"
          @submit.prevent="addArtist"
        >
          <input
            v-model="artistName"
            aria-label="添加画师"
            placeholder="输入画师 tag…"
            :disabled="busy"
          />
          <button
            class="icon-btn"
            :disabled="busy || !artistName.trim()"
            aria-label="添加画师"
          >
            <Icon
              name="plus"
              :size="16"
            />
          </button>
        </form>
        <details class="artist-raw">
          <summary>查看画师串原文</summary>
          <code>{{ artistString(selected.artists) || '（无画师）' }}</code
          ><button
            class="artist-text-button"
            @click="copy"
          >
            复制画师串
          </button>
        </details>
        <details
          v-if="state.schemes.length"
          class="artist-legacy"
        >
          <summary>找回旧版画师串（{{ state.schemes.length }}）</summary>
          <div
            v-for="scheme in state.schemes"
            :key="scheme.id"
            class="artist-legacy-entry"
          >
            <span>{{ scheme.name || '未命名' }}</span>
            <button
              class="artist-text-button"
              :disabled="busy"
              :aria-label="`载入旧版画师串 ${scheme.name}`"
              @click="studio.restoreLegacyScheme(scheme.id)"
            >
              载入
            </button>
          </div>
        </details>
      </section>

      <section class="artist-comparison">
        <header class="artist-section-heading">
          <h3>效果对照</h3>
          <span
            v-if="
              studio.baselineReference.value &&
              studio.baselineReference.value.version !== state.context.version
            "
            >蓝本 {{ studio.baselineReference.value.version.toUpperCase() }} · 当前
            {{ state.context.version.toUpperCase() }}</span
          >
          <span v-else>同内容 · 同参数 · 同种子</span>
          <details
            v-if="changes.length"
            class="artist-diff"
          >
            <summary>改动 {{ changes.length }}</summary>
            <div
              v-if="changes.length"
              class="artist-diff-items"
            >
              <span
                v-for="change in changes"
                :key="change"
                >{{ change }}</span
              >
            </div>
          </details>
        </header>
        <div class="artist-image-pair">
          <article class="artist-image-card">
            <header>
              <span class="artist-baseline-badge">基准</span
              ><strong>{{
                studio.baselineReference.value?.origin === 'blueprint' ? '蓝本原图' : '当前基准'
              }}</strong>
              <button
                v-if="studio.canChoose.value"
                class="artist-pick"
                aria-label="选基准图"
                @click="studio.chooseWinner('baseline')"
              >
                <Icon
                  name="check"
                  :size="13"
                />选这张
              </button>
            </header>
            <button
              v-if="baselineImage"
              class="artist-generated"
              aria-label="放大基准图"
              @click="viewer = baselineImage"
            >
              <img
                :src="baselineImage.url"
                alt="基准图"
                @error="studio.invalidateImage(state.baseline)"
              />
            </button>
            <div
              v-else
              class="artist-image-empty"
            >
              <div class="artist-image-symbol">
                <Icon
                  name="image"
                  :size="32"
                />
              </div>
              <span>尚未生成</span>
            </div>
          </article>
          <article class="artist-image-card candidate">
            <header>
              <span class="artist-candidate-badge">新图</span><strong>当前调整</strong>
              <button
                v-if="studio.canChoose.value"
                class="artist-pick"
                aria-label="选新图"
                @click="studio.chooseWinner('candidate')"
              >
                <Icon
                  name="check"
                  :size="13"
                />选这张
              </button>
            </header>
            <button
              v-if="candidateImage"
              class="artist-generated"
              aria-label="放大候选图"
              @click="viewer = candidateImage"
            >
              <img
                :src="candidateImage.url"
                alt="候选方案生成图"
                @error="studio.invalidateImage(selected)"
              />
            </button>
            <div
              v-else
              class="artist-image-empty"
            >
              <div class="artist-image-symbol">
                <Icon
                  name="brush"
                  :size="32"
                />
              </div>
              <span>{{ studio.hasChanges.value ? '尚未生成' : '调整左侧画师后生成新图' }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>

    <footer
      class="pane-foot artist-footer"
      data-toast-avoid
    >
      <div
        v-if="trials.error || persistenceError || studio.sourceChanged.value"
        class="artist-run-status"
        aria-live="polite"
      >
        <span
          v-if="trials.error || persistenceError"
          class="artist-error"
          >{{ trials.error || persistenceError }}</span
        >
        <span v-else-if="studio.sourceChanged.value">{{
          studio.sourceTab.value
            ? '来源标签已修改，当前对照仍使用旧蓝本'
            : '来源标签已关闭，可更换蓝本继续'
        }}</span>
      </div>

      <div class="row run-bar artist-toolbar">
        <div class="artist-content-source">
          <button
            class="btn"
            :disabled="busy"
            @click="blueprints?.open()"
          >
            {{ studio.hasContent.value ? '更换蓝本' : '选择蓝本' }}
          </button>
          <button
            v-if="state.source === 'creation' && studio.sourceTab.value"
            class="artist-text-button"
            :disabled="busy"
            :title="studio.sourceTab.value?.title"
            @click="studio.editSource"
          >
            编辑来源
          </button>
          <button
            v-if="studio.sourceChanged.value && studio.sourceTab.value"
            class="artist-text-button artist-content-update"
            :disabled="busy"
            @click="studio.refreshSource"
          >
            更新蓝本
          </button>
          <button
            class="btn"
            :disabled="busy"
            aria-label="调整固定种子"
            @click="openSeed"
          >
            <Icon
              name="lock"
              :size="14"
            />固定种子
            <span class="artist-settings-summary">{{ state.context.params.seed }}</span>
          </button>
        </div>
        <div class="run-actions artist-run-actions">
          <button
            class="btn"
            :disabled="
              busy || !baselineImage || studio.hasChanges.value || studio.sourceChanged.value
            "
            :title="
              state.source === 'creation'
                ? `应用到 ${studio.sourceTab.value?.title || state.sourceTitle}，可撤销`
                : '将选定的画师串与蓝本内容在创作页打开'
            "
            @click="studio.applyToCreation"
          >
            {{ state.source === 'creation' ? '带回来源标签' : '在创作页打开' }}
          </button>
          <span
            v-if="studio.hasContent.value && studio.pendingCount.value && !trials.running"
            class="artist-generation-count"
            title="按账户额度计费"
            >{{ studio.pendingCount.value }} 张</span
          >
          <RunButton
            label="生成对照"
            running-label="试图中"
            :running="trials.running"
            :stopping="trials.stopRequested"
            :disabled="busy || !studio.hasContent.value || !studio.pendingCount.value"
            :current="finishedTrials"
            :total="trials.running ? trials.trials.length : undefined"
            stop-title="当前这张完成后停止试图"
            @run="studio.generate"
            @stop="studio.stop"
          />
        </div>
      </div>
    </footer>

    <dialog
      ref="pasteDialog"
      class="artist-dialog"
      @pointerdown="pasteBackdrop.onPointerdown"
      @click="pasteBackdrop.onClick"
    >
      <header class="artist-dialog-heading">
        <h3>粘贴画师串</h3>
        <button
          class="icon-btn"
          aria-label="关闭画师串输入"
          @click="pasteDialog?.close()"
        >
          <Icon
            name="x"
            :size="18"
          />
        </button>
      </header>
      <div class="artist-dialog-body">
        <p>替换当前候选中的画师，支持数值权重和括号加权。</p>
        <textarea
          v-model="pasted"
          aria-label="画师串原文"
          rows="7"
          placeholder="0.8::artist:wlop::, 0.6::artist:rella::"
        />
        <p
          v-if="pasteError"
          class="artist-error"
          role="alert"
        >
          {{ pasteError }}
        </p>
      </div>
      <footer>
        <button
          class="btn"
          @click="pasteDialog?.close()"
        >
          取消</button
        ><button
          class="btn primary"
          @click="applyPaste"
        >
          替换当前画师串
        </button>
      </footer>
    </dialog>
    <dialog
      ref="seedDialog"
      class="artist-dialog artist-seed-dialog"
      aria-labelledby="artist-seed-title"
      @pointerdown="seedBackdrop.onPointerdown"
      @click="seedBackdrop.onClick"
    >
      <header class="artist-dialog-heading">
        <h3 id="artist-seed-title">固定种子</h3>
        <button
          class="icon-btn"
          aria-label="关闭种子设置"
          @click="closeSeed"
        >
          <Icon
            name="x"
            :size="18"
          />
        </button>
      </header>
      <div class="artist-dialog-body">
        <div class="artist-seed-control">
          <label
            >种子
            <div class="artist-seed-field">
              <input
                v-model.number="state.context.params.seed"
                aria-label="固定种子"
                type="number"
                min="0"
                max="4294967295"
              /><button
                class="icon-btn"
                aria-label="换一个固定种子"
                @click="randomSeed"
              >
                <Icon
                  name="dice"
                  :size="15"
                />
              </button></div
          ></label>
        </div>
      </div>
      <footer>
        <button
          class="btn primary"
          @click="closeSeed"
        >
          完成
        </button>
      </footer>
    </dialog>
    <ArtistBlueprintPicker
      ref="blueprints"
      :version="state.context.version"
      :busy="busy"
      @select="studio.useBlueprint"
    />
    <ArtistCatalog
      ref="catalog"
      :selected="selected.artists.map((artist) => artist.name)"
      :favorites="state.favoriteArtists"
      :busy="busy"
      :version="state.context.version"
      @add="addFromCatalog"
      @favorite="studio.toggleFavorite"
    />
    <ImageViewer
      v-if="viewer && shellState.tab === 'artists'"
      :image="viewer"
      :can-previous="false"
      :can-next="false"
      @close="viewer = undefined"
    />
  </div>
</template>

<style scoped src="./studio.css"></style>
