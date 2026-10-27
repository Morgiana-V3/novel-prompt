<script setup lang="ts">
import { promptState } from '../../prompts/state'
import { computed } from 'vue'
import type { UcPreset, NaiGenParams } from '@shared/generation/types'

/** 推测与生图共用的参数（作为若干个 .param 直接放进父级网格）；only 用来只渲染其中几项 */
type Part = 'size' | 'quality' | 'uc'
const props = defineProps<{
  only?: Part[]
  params?: Pick<NaiGenParams, 'width' | 'height' | 'qualityTags' | 'ucPreset'>
  disabled?: boolean
  sizeLocked?: boolean
}>()
const show = (field: Part) => !props.only || props.only.includes(field)

const SIZES = [
  { key: 'portrait', label: '竖图', w: 832, h: 1216 },
  { key: 'landscape', label: '横图', w: 1216, h: 832 },
  { key: 'square', label: '方图', w: 1024, h: 1024 },
]
const UC_OPTIONS: { key: UcPreset; label: string }[] = [
  { key: 'heavy', label: 'Heavy' },
  { key: 'light', label: 'Light' },
  { key: 'human', label: '人物' },
  { key: 'none', label: '无' },
]
const emit = defineEmits<{ changeParams: [patch: Partial<NonNullable<typeof props.params>>] }>()
const parameters = computed(() => props.params ?? promptState.params)
function updateParameters(patch: Partial<NonNullable<typeof props.params>>) {
  if (props.params) {
    emit('changeParams', patch)
  } else {
    Object.assign(promptState.params, patch)
  }
}
const sizeKey = computed(
  () =>
    SIZES.find(
      (sizeOption) =>
        sizeOption.w === parameters.value.width && sizeOption.h === parameters.value.height,
    )?.key ?? 'custom',
)

function setSize(width: number, height: number) {
  updateParameters({ width: width, height: height })
}
</script>

<template>
  <div
    v-if="show('size')"
    class="param"
  >
    <span
      class="side-label"
      :title="sizeLocked ? '遮罩坐标与底图绑定；移除遮罩后可调整画幅' : undefined"
      >画幅 · {{ parameters.width }}×{{ parameters.height
      }}<template v-if="sizeLocked && !disabled"> · 与遮罩尺寸一致</template></span
    >
    <div class="seg block">
      <button
        v-for="option in SIZES"
        :key="option.key"
        :disabled="disabled || sizeLocked"
        :class="{ on: sizeKey === option.key }"
        @click="setSize(option.w, option.h)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
  <div
    v-if="show('quality')"
    class="param"
  >
    <span class="side-label">Add Quality Tags</span>
    <div class="seg block">
      <button
        :disabled="disabled"
        :class="{ on: parameters.qualityTags }"
        @click="updateParameters({ qualityTags: true })"
      >
        开
      </button>
      <button
        :disabled="disabled"
        :class="{ on: !parameters.qualityTags }"
        @click="updateParameters({ qualityTags: false })"
      >
        关
      </button>
    </div>
  </div>
  <div
    v-if="show('uc')"
    class="param wide"
  >
    <span class="side-label">UC 预设</span>
    <div class="seg block">
      <button
        v-for="option in UC_OPTIONS"
        :key="option.key"
        :disabled="disabled"
        :class="{ on: parameters.ucPreset === option.key }"
        @click="updateParameters({ ucPreset: option.key })"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
