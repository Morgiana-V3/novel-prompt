<script setup lang="ts">
import IconSwap from '../../shared/ui/IconSwap.vue'
import { computed } from 'vue'
import type { ReverseResult } from '@shared/reverse/types'
import { rankArtists } from '@shared/reverse/candidates'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  result?: ReverseResult
  selected: string[]
  /** 混合组成里的画师 */
  members: string[]
  busy: boolean
  running: boolean
}>()
const threshold = defineModel<number>('threshold', { required: true })
const emit = defineEmits<{ toggle: [name: string]; member: [name: string] }>()
const recommendations = computed(() => (props.result ? rankArtists(props.result) : []))
const visible = computed(() => recommendations.value.slice(0, 10))
const selected = (name: string) =>
  props.selected.some((item) => item.toLowerCase() === name.toLowerCase())
const isMember = (name: string) =>
  props.members.some((item) => item.toLowerCase() === name.toLowerCase())
</script>

<template>
  <section
    class="artist-recommendations"
    aria-label="推荐画师"
  >
    <header>
      <div>
        <strong title="勾选的画师用于「对比画师」；「组成」开关决定混合成员。详见设置里的操作说明"
          >推荐画师</strong
        >
      </div>
      <span class="method-label">{{
        (result?.artists.length ?? 0) > 1 ? '综合推荐' : '单模型推荐'
      }}</span>
    </header>
    <template v-if="recommendations.length">
      <ol class="recommendation-list">
        <li
          v-for="(artist, index) in visible"
          :key="artist.name"
          class="recommendation-item"
        >
          <button
            class="recommendation"
            :class="{ selected: selected(artist.name) }"
            :disabled="busy"
            :aria-pressed="selected(artist.name)"
            :title="selected(artist.name) ? '已选，点击取消' : '点击选中，加入试图'"
            @click="emit('toggle', artist.name)"
          >
            <span class="recommendation-rank">{{ index + 1 }}</span>
            <strong class="recommendation-name">{{ artist.name }}</strong>
            <span
              v-if="artist.sources.length > 1"
              class="recommendation-both"
              title="两个画风模型都推荐了这位画师"
              >双模型</span
            >
            <span
              class="recommendation-check"
              aria-hidden="true"
              ><Icon
                v-if="selected(artist.name)"
                name="check"
                :size="11"
            /></span>
          </button>
          <button
            class="recommendation-member"
            :class="{ on: isMember(artist.name) }"
            :disabled="busy"
            :aria-pressed="isMember(artist.name)"
            :title="
              isMember(artist.name)
                ? '在混合组成里，点击移出'
                : '加入混合组成，比例会按概率重新换算'
            "
            @click="emit('member', artist.name)"
          >
            <Icon
              name="palette"
              :size="12"
            />组成
          </button>
        </li>
      </ol>
    </template>
    <p
      v-else
      class="recommendation-empty"
    >
      {{
        running
          ? '正在识别画风…'
          : result
            ? '没有画师候选，请启用画风识别模型后重新识别。'
            : '识别图片后，在这里挑选值得尝试的画师。'
      }}
    </p>
    <details
      v-if="result?.artists.length"
      class="recognition-details"
    >
      <summary class="disclosure">识别详情 <span>模型排名与原始分数</span></summary>
      <label
        >原始分数筛选<input
          v-model.number="threshold"
          class="input sm"
          type="number"
          min="0"
          max="1"
          step="0.001"
          aria-label="画师候选阈值"
          :disabled="busy"
      /></label>
      <div class="model-results">
        <section
          v-for="group in result.artists"
          :key="group.model"
        >
          <strong>{{ group.model }}</strong>
          <ol>
            <li
              v-for="tag in group.tags.filter((tag) => tag.score >= threshold).slice(0, 10)"
              :key="tag.name"
            >
              <button
                :disabled="busy"
                :aria-pressed="selected(tag.name)"
                @click="emit('toggle', tag.name)"
              >
                <span>{{ tag.name }}</span
                ><small>{{ tag.score.toFixed(4) }}</small
                ><IconSwap
                  :name="selected(tag.name) ? 'check' : 'plus'"
                  :size="12"
                />
              </button>
            </li>
          </ol>
          <p v-if="!group.tags.some((tag) => tag.score >= threshold)">当前筛选下没有候选</p>
        </section>
      </div>
    </details>
  </section>
</template>

<style scoped>
.artist-recommendations {
  padding: 18px;
}

header,
header > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

header {
  justify-content: space-between;
}

header strong {
  font-size: 14px;
}

header span,
.recommendation-empty {
  font-size: 11px;
  color: var(--muted);
}

.method-label {
  border: 1px solid var(--line);
  padding: 4px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.recommendation-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 4px 12px;
}

.recommendation-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 混合组成开关：粉色表示这位画师在组成里 */
.recommendation-member {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.recommendation-member:hover:not(:disabled) {
  border-color: var(--pink-line);
  color: var(--pink-deep);
}

.recommendation-member.on {
  border-color: var(--pink-line);
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.recommendation {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  text-align: left;
  color: var(--text2);
  transition:
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.recommendation:hover:not(:disabled) {
  background: var(--panel);
}

.recommendation.selected {
  color: var(--text);
}

.recommendation-rank {
  width: 16px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.recommendation-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommendation-both {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--text2);
  background: var(--hover);
  font-size: 10px;
}

.recommendation-check {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--line2);
  border-radius: 5px;
  color: #fff;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.selected .recommendation-check {
  border-color: var(--pink);
  background: var(--pink);
}

.more-artists {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 14px auto;
  color: var(--text2);
  font-size: 11px;
}

.recognition-details {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--text2);
}

summary {
  cursor: pointer;
}

summary span {
  margin-left: 8px;
  color: var(--muted);
}

.recognition-details p {
  line-height: 1.8;
  color: var(--muted);
}

.recognition-details label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.recognition-details input {
  width: 80px;
  height: 28px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font: 12px var(--mono);
  appearance: textfield;
}

/* 去掉浏览器自带的上下箭头，和其他阈值输入框一致 */
.recognition-details input::-webkit-inner-spin-button,
.recognition-details input::-webkit-outer-spin-button {
  appearance: none;
}

.model-results {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 20px;
  margin-top: 16px;
}

.model-results ol {
  padding-left: 20px;
}

.model-results button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 0;
  text-align: left;
}

.model-results button span {
  flex: 1;
  overflow-wrap: anywhere;
}

.model-results small {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

@media (width <= 1100px) {
  header > div {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
}
</style>
