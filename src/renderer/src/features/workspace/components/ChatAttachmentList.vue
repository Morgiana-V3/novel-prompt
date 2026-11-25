<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NaiImage } from '@shared/images/types'
import { ATTACHMENT_LABELS, type ChatAttachment } from '@shared/workspace/attachments'
import { referenceModes } from '@shared/generation/references'
import Icon from '../../../shared/ui/Icon.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import ImageViewer from '../../../shared/ui/ImageViewer.vue'
const props = defineProps<{
  images: ChatAttachment[]
  editable?: boolean
  model?: 'v4.5' | 'v5'
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [images: ChatAttachment[]] }>()
const preview = ref<NaiImage>()
const options = computed(() =>
  (['discussion', ...referenceModes(props.model ?? 'v4.5')] as const).map((value) => ({
    value,
    label: ATTACHMENT_LABELS[value],
  })),
)
const url = (image: ChatAttachment) => 'np-img://img/' + encodeURIComponent(image.imageName)
</script>
<template>
  <div class="chat-images">
    <div
      v-for="(image, index) in images"
      :key="image.imageName"
      class="chat-image"
    >
      <button
        class="chat-thumb"
        :title="image.label"
        :aria-label="'查看图 ' + (index + 1) + ' ' + image.label"
        @click="preview = { name: image.label, url: url(image), createdAt: 0 }"
      >
        <img
          :src="url(image)"
          :alt="image.label"
        />
      </button>
      <div
        class="chat-image-info"
        :class="{ 'chat-image-info-editable': editable }"
      >
        <small>图 {{ index + 1 }}</small>
        <ThemeSelect
          v-if="editable"
          compact
          :model-value="image.purpose"
          :options="options"
          :disabled="disabled"
          :aria-label="'图 ' + (index + 1) + ' 用途'"
          @update:model-value="
            (purpose) =>
              emit(
                'change',
                images.map((item, i) => (i === index ? { ...item, purpose } : item)),
              )
          "
        />
        <span v-else>{{ ATTACHMENT_LABELS[image.purpose] }}</span>
      </div>
      <button
        v-if="editable"
        class="chat-remove"
        :disabled="disabled"
        :aria-label="'移除图 ' + (index + 1)"
        title="移除附图"
        @click="
          emit(
            'change',
            images.filter((_, i) => i !== index),
          )
        "
      >
        <Icon
          name="x"
          :size="12"
        />
      </button>
    </div>
    <ImageViewer
      v-if="preview"
      :image="preview"
      :can-previous="false"
      :can-next="false"
      @close="preview = undefined"
    />
  </div>
</template>
<style scoped>
.chat-images {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 5px 0;
}

.chat-image {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  max-width: 100%;
  padding: 4px;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 9px;
}

.chat-thumb {
  width: 38px;
  height: 42px;
  overflow: hidden;
  background: var(--panel);
  border-radius: 5px;
  cursor: zoom-in;
}

.chat-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.chat-image-info {
  display: grid;
  justify-items: start;
  gap: 2px;
  min-width: 0;
  font-size: 11px;
  line-height: 1.25;
}

.chat-image-info small {
  font-size: 10px;
  color: var(--text2);
}

.chat-image-info-editable small {
  padding-inline: 7px;
}

.chat-remove {
  align-self: flex-start;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--muted);
  border-radius: 4px;
}

.chat-remove:hover {
  color: var(--bad);
  background: var(--bad-soft);
}
</style>
