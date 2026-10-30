<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReverseResult } from '@shared/reverse/types'
import { rankArtists } from '@shared/reverse/candidates'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  result?: ReverseResult
  selected: string[]
  busy: boolean
  running: boolean
}>()
const threshold = defineModel<number>('threshold', { required: true })
const emit = defineEmits<{ toggle: [name: string] }>()
const expanded = ref(false)
const recommendations = computed(() => (props.result ? rankArtists(props.result) : []))
const visible = computed(() => recommendations.value.slice(0, expanded.value ? 10 : 5))
const selected = (name: string) =>
  props.selected.some((item) => item.toLowerCase() === name.toLowerCase())
const agreement = computed(() => {
  const heads =
    props.result?.artists.map((group) => group.tags[0]?.name.toLowerCase().replaceAll('_', ' ')) ??
    []
  return heads.length > 1 && new Set(heads).size > 1
})
</script>

<template>
  <section
    class="artist-recommendations"
    aria-label="推荐画师"
  >
    <header>
      <div><strong>推荐画师</strong><span>先选画风，再用试图确认</span></div>
      <span class="method-label">{{
        (result?.artists.length ?? 0) > 1 ? '综合推荐' : '单模型推荐'
      }}</span>
    </header>
    <template v-if="recommendations.length">
      <p class="recommendation-note">
        {{
          agreement
            ? '模型首选不同，建议对比前几位的试图效果。'
            : '按候选排名整理，推荐顺序不代表相似百分比。'
        }}
      </p>
      <ol class="recommendation-list">
        <li
          v-for="(artist, index) in visible"
          :key="artist.name"
        >
          <button
            class="recommendation"
            :class="{ selected: selected(artist.name), leading: index === 0 }"
            :disabled="busy"
            :aria-pressed="selected(artist.name)"
            @click="emit('toggle', artist.name)"
          >
            <span class="recommendation-rank">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="recommendation-name"
              ><strong>{{ artist.name }}</strong
              ><small>{{
                artist.sources.length > 1 ? '两个模型均推荐' : '单个模型推荐'
              }}</small></span
            >
            <span
              v-if="index === 0"
              class="recommendation-first"
              >优先试试</span
            >
            <span class="recommendation-add"
              ><Icon
                :name="selected(artist.name) ? 'check' : 'plus'"
                :size="14"
            /></span>
          </button>
        </li>
      </ol>
      <button
        v-if="recommendations.length > 5"
        class="more-artists"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起候选' : '查看更多候选'
        }}<Icon
          name="chevron"
          :size="11"
        />
      </button>
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
      <summary>识别详情 <span>模型排名与原始分数</span></summary>
      <p>
        综合推荐按名次融合，偏重靠前候选；不直接平均模型分数。原始分数不代表相似百分比或提示词权重。
      </p>
      <label
        >原始分数筛选<input
          v-model.number="threshold"
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
                ><Icon
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
.recommendation-note,
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

.recommendation-note {
  margin: 10px 0 16px;
  line-height: 1.7;
}

.recommendation-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.recommendation {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  text-align: left;
  color: var(--text2);
  transition:
    background-color 160ms ease,
    border-color 160ms ease;
}

.recommendation:hover {
  background: var(--panel);
}

.recommendation.leading {
  background: var(--panel);
  border-color: var(--line);
}

.recommendation.selected {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.recommendation-rank {
  width: 20px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.recommendation-name {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.recommendation-name strong {
  font-size: 13px;
  font-weight: 550;
  overflow-wrap: anywhere;
}

.recommendation-name small {
  font-size: 10px;
  color: var(--muted);
}

.recommendation-first {
  font-size: 10px;
  color: var(--pink-deep);
  white-space: nowrap;
}

.recommendation-add {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}

.selected .recommendation-add {
  color: var(--pink-deep);
  border-color: var(--pink-line);
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
