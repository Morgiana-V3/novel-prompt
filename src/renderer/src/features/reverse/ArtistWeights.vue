<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import { removeStyleArtist, setArtistWeight, styleArtists } from './artist-weights'

const prompt = defineModel<string>({ required: true })
const props = defineProps<{ disabled: boolean }>()
const artists = computed(() => styleArtists(prompt.value))

function update(index: number, weight: number) {
  if (!props.disabled) {
    prompt.value = setArtistWeight(prompt.value, index, weight)
  }
}
function inputWeight(event: Event, index: number, previous: number) {
  const input = event.target as HTMLInputElement
  if (input.value.trim() && Number.isFinite(input.valueAsNumber)) {
    update(index, input.valueAsNumber)
  } else {
    input.value = String(previous)
  }
}
function remove(index: number) {
  if (!props.disabled) {
    prompt.value = removeStyleArtist(prompt.value, index)
  }
}
</script>

<template>
  <div
    v-if="artists.length"
    class="artist-weights"
    aria-label="逐项画师权重"
  >
    <div
      v-for="artist in artists"
      :key="artist.index"
      class="artist-weight-row"
    >
      <span
        class="artist-weight-name"
        :title="artist.core"
        >{{ artist.core }}</span
      >
      <div class="artist-weight-control">
        <button
          type="button"
          :disabled="disabled"
          :aria-label="`降低 ${artist.core} 权重`"
          @click="update(artist.index, artist.weight - 0.05)"
        >
          −
        </button>
        <input
          type="number"
          step="0.001"
          :value="artist.weight"
          :disabled="disabled"
          :aria-label="`${artist.core} 权重`"
          @change="inputWeight($event, artist.index, artist.weight)"
        />
        <button
          type="button"
          :disabled="disabled"
          :aria-label="`增加 ${artist.core} 权重`"
          @click="update(artist.index, artist.weight + 0.05)"
        >
          +
        </button>
      </div>
      <button
        class="btn small ghost"
        :disabled="disabled || artist.weight === 1"
        :aria-label="`重置 ${artist.core} 权重`"
        @click="update(artist.index, 1)"
      >
        重置
      </button>
      <button
        class="icon-btn sm"
        :disabled="disabled"
        :aria-label="`移除画师 ${artist.core}`"
        @click="remove(artist.index)"
      >
        <Icon
          name="x"
          :size="12"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.artist-weights {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px 12px;
}

.artist-weight-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}

.artist-weight-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.artist-weight-control {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}

.artist-weight-control button {
  width: 26px;
  height: 28px;
  border: 0;
  color: var(--text2);
  background: var(--panel);
  cursor: pointer;
}

.artist-weight-control button:hover:not(:disabled) {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.artist-weight-control input {
  width: 68px;
  height: 28px;
  padding: 2px 4px;
  border: 0;
  border-inline: 1px solid var(--line);
  color: var(--text);
  background: var(--bg);
  font: 12px var(--mono);
  text-align: center;
}
</style>
