<script setup lang="ts">
import { computed } from 'vue'
import type { UcPreset } from '@shared/types'
import { state } from '../store'

/** 推测与生图共用的参数（作为若干个 .param 直接放进父级网格） */
const SIZES = [
  { key: 'portrait', label: '竖图', w: 832, h: 1216 },
  { key: 'landscape', label: '横图', w: 1216, h: 832 },
  { key: 'square', label: '方图', w: 1024, h: 1024 }
]
const UC_OPTIONS: { key: UcPreset; label: string }[] = [
  { key: 'heavy', label: 'Heavy' },
  { key: 'light', label: 'Light' },
  { key: 'human', label: '人物' },
  { key: 'none', label: '无' }
]
const p = state.params
const sizeKey = computed(() => SIZES.find((s) => s.w === p.width && s.h === p.height)?.key ?? 'custom')

function setSize(w: number, h: number) {
  p.width = w
  p.height = h
}
</script>

<template>
  <div class="param">
    <span class="side-label">画幅 · {{ p.width }}×{{ p.height }}</span>
    <div class="seg block">
      <button v-for="s in SIZES" :key="s.key" :class="{ on: sizeKey === s.key }" @click="setSize(s.w, s.h)">{{ s.label }}</button>
    </div>
  </div>
  <div class="param">
    <span class="side-label">Add Quality Tags</span>
    <div class="seg block">
      <button :class="{ on: p.qualityTags }" @click="p.qualityTags = true">开</button>
      <button :class="{ on: !p.qualityTags }" @click="p.qualityTags = false">关</button>
    </div>
  </div>
  <div class="param wide">
    <span class="side-label">UC 预设</span>
    <div class="seg block">
      <button v-for="u in UC_OPTIONS" :key="u.key" :class="{ on: p.ucPreset === u.key }" @click="p.ucPreset = u.key">{{ u.label }}</button>
    </div>
  </div>
</template>
