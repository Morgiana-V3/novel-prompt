<script setup lang="ts">
import { computed } from 'vue'
import type { EvidenceInfo } from '@shared/prompts/types'
import Icon from '../../../shared/ui/Icon.vue'

const props = defineProps<{ info: EvidenceInfo }>()

const used = computed(() => [
  ...props.info.related,
  ...props.info.wiki.filter((text) => !props.info.related.includes(text)),
])
const empty = computed(() => !used.value.length && !props.info.failed.length)
</script>

<template>
  <div
    v-if="!empty || !info.implications"
    :class="['evidence-note', { warn: info.failed.length }]"
  >
    <Icon
      :name="info.failed.length ? 'warn' : 'book'"
      :size="14"
    />
    <div class="evidence-text">
      <template v-if="used.length">
        参考了 Danbooru 统计：
        <span class="evidence-tags">{{ used.join('、') }}</span>
      </template>
      <template v-if="info.failed.length">
        <span v-if="used.length">；</span>
        {{ info.failed.join('、') }}
        的统计数据没获取到（网络不可用），相关判断只凭经验，置信度已降低
      </template>
      <template v-if="!info.implications">
        <span v-if="!empty">；</span>
        本地还没有包含关系数据，冗余检查未生效，可在「设置 / 数据」中下载
      </template>
    </div>
  </div>
</template>
