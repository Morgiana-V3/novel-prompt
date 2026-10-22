<script setup lang="ts">
import type { TagDiff } from '../tag-diff'

defineProps<{ diff: TagDiff }>()
</script>

<template>
  <div class="diff-row" v-if="diff.added.length || diff.removed.length || diff.changed.length">
    <span class="diff-chip add" v-for="t in diff.added" :key="'a' + t.key">+ {{ t.text }}</span>
    <span class="diff-chip mod" v-for="c in diff.changed" :key="'c' + c.to.key">{{ c.from.text }} → {{ c.to.text }}</span>
    <span class="diff-chip del" v-for="t in diff.removed" :key="'d' + t.key">{{ t.text }}</span>
  </div>
</template>
