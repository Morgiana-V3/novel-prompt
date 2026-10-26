<script setup lang="ts">
import { computed } from 'vue'
import type { UcPreset, NaiGenParams } from '@shared/types'
import { state } from '../store'

/** 推测与生图共用的参数（作为若干个 .param 直接放进父级网格）；only 用来只渲染其中几项 */
type Part = 'size' | 'quality' | 'uc'
const props = defineProps<{ only?: Part[]; params?: Pick<NaiGenParams, 'width'|'height'|'qualityTags'|'ucPreset'>; disabled?: boolean; sizeLocked?: boolean }>()
const show = (k: Part) => !props.only || props.only.includes(k)

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
const p = computed(() => props.params ?? state.params)
const sizeKey = computed(() => SIZES.find((s) => s.w === p.value.width && s.h === p.value.height)?.key ?? 'custom')

function setSize(w: number, h: number) {
  p.value.width = w
  p.value.height = h
}
</script>

<template>
  <div class="param" v-if="show('size')">
    <span class="side-label" :title="sizeLocked ? '遮罩坐标与底图绑定；移除遮罩后可调整画幅' : undefined">画幅 · {{ p.width }}×{{ p.height }}<template v-if="sizeLocked && !disabled"> · 与遮罩尺寸一致</template></span>
    <div class="seg block">
      <button v-for="s in SIZES" :key="s.key" :disabled="disabled || sizeLocked" :class="{ on: sizeKey === s.key }" @click="setSize(s.w, s.h)">{{ s.label }}</button>
    </div>
  </div>
  <div class="param" v-if="show('quality')">
    <span class="side-label">Add Quality Tags</span>
    <div class="seg block">
      <button :disabled="disabled" :class="{ on: p.qualityTags }" @click="p.qualityTags = true">开</button>
      <button :disabled="disabled" :class="{ on: !p.qualityTags }" @click="p.qualityTags = false">关</button>
    </div>
  </div>
  <div class="param wide" v-if="show('uc')">
    <span class="side-label">UC 预设</span>
    <div class="seg block">
      <button v-for="u in UC_OPTIONS" :key="u.key" :disabled="disabled" :class="{ on: p.ucPreset === u.key }" @click="p.ucPreset = u.key">{{ u.label }}</button>
    </div>
  </div>
</template>
