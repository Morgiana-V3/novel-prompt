<script setup lang="ts">
import Icon from '../../shared/ui/Icon.vue'
import { PORT_OFFSET, PORT_SIDES, type PortPull, type PortSide } from './canvas-ports'
import type { ScreenRect } from './use-canvas-overlay'

defineProps<{
  bounds: ScreenRect
  selected: boolean
  wiring: boolean
  pull?: PortPull
  label: string
}>()
defineEmits<{ wire: [event: PointerEvent, side: PortSide] }>()
</script>

<template>
  <div
    class="canvas-port-node"
    :class="{ 'show-ports': selected || pull }"
    :style="{
      left: bounds.left + 'px',
      top: bounds.top + 'px',
      width: bounds.width + 'px',
      height: bounds.height + 'px',
      zIndex: selected ? 2 : 1,
      '--port-offset': PORT_OFFSET + 'px',
    }"
  >
    <slot />
    <template v-if="!wiring">
      <button
        v-for="side in PORT_SIDES"
        :key="side"
        class="canvas-port"
        :class="{ 'port-active': pull?.side === side }"
        :data-port-side="side"
        :style="{
          '--pull-x': (pull?.side === side ? pull.x : 0) + 'px',
          '--pull-y': (pull?.side === side ? pull.y : 0) + 'px',
        }"
        type="button"
        :aria-label="label + (side === 'left' ? '左端口' : '右端口')"
        :title="label + ' · 拖动建立连线'"
        @pointerdown.stop.prevent="$emit('wire', $event, side)"
      >
        <Icon
          name="plus"
          :size="13"
        />
      </button>
    </template>
  </div>
</template>

<style scoped>
.canvas-port-node {
  position: absolute;
}

.canvas-port {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: calc(100% + var(--port-offset));
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line2);
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  color: var(--text2);
  transform: translate3d(calc(-50% + var(--pull-x)), calc(-50% + var(--pull-y)), 0);
  cursor: crosshair;
  opacity: 0;
  pointer-events: none;
  transition:
    transform 110ms ease-out,
    opacity 80ms ease-out,
    background-color 80ms ease-out;
}

.canvas-port[data-port-side='left'] {
  left: calc(0px - var(--port-offset));
}

:where(.canvas-port-node:hover, .show-ports) .canvas-port {
  opacity: 0.48;
  pointer-events: auto;
}

.canvas-port.port-active,
.canvas-port:focus-visible {
  opacity: 1;
  pointer-events: auto;
  border-color: color-mix(in srgb, var(--text2) 55%, var(--line2));
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-sm);
  transition-duration: 45ms;
}
</style>
