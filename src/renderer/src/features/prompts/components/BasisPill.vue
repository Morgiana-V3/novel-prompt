<script setup lang="ts">
import type { Basis } from '@shared/prompts/types'

defineProps<{ basis: Basis }>()

const LABEL: Record<Basis, { text: string; cls: string; tip: string }> = {
  rule: {
    text: '规则',
    cls: 'bad',
    tip: '硬规则：tag 存在性、别名、语法、正负面重复等，属于必须修正的问题',
  },
  data: {
    text: '数据',
    cls: 'nl',
    tip: 'Danbooru 统计数据：引用数、包含关系、共现（角色默认外观、画师倾向）',
  },
  doc: {
    text: '文档',
    cls: 'ok',
    tip: '提示词规范里的官方说明或经验做法（依据中注明【官方】/【经验】）',
  },
  taste: { text: '审美', cls: 'taste', tip: '审美偏好，仅供参考，不会直接改动你的提示词' },
}
</script>

<template>
  <span
    :class="['pill basis', LABEL[basis].cls]"
    :title="LABEL[basis].tip"
    >{{ LABEL[basis].text }}</span
  >
</template>
