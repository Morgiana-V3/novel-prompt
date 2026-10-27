<script setup lang="ts">
import { ICONS, type IconName } from './icons'

withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), {
  size: 18,
  stroke: 1.8,
})
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- Only the bundled, static SVG icon registry is rendered. -->
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="ICONS[name]"
  ></svg>
</template>
