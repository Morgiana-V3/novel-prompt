<script setup lang="ts">
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import { PREVIEW_LIMIT_OPTIONS, previewPreferences } from './preview-preferences'

/** 图片预览：生图创作右侧「最近生成」最多显示多少张，更早的图片在图集管理 */
function setLimit(value: number) {
  previewPreferences.recentLimit = value
}
</script>

<template>
  <div
    class="card"
    style="--d: 160ms"
  >
    <div class="card-head">
      <span class="card-icon"><Icon name="image" /></span>
      <div>
        <h2>图片预览</h2>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-field full">
        <label>最近生成显示数量</label>
        <div
          v-seg-indicator
          class="seg"
        >
          <button
            v-for="option in PREVIEW_LIMIT_OPTIONS"
            :key="option"
            :class="{ on: previewPreferences.recentLimit === option }"
            @click="setLimit(option)"
          >
            {{ option }} 张
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
