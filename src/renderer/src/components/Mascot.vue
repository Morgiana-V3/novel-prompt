<script setup lang="ts">
import { computed } from 'vue'
import idle from '../assets/mascot/idle.png'
import happy from '../assets/mascot/happy.png'
import busy from '../assets/mascot/busy.png'
import confused from '../assets/mascot/confused.png'
import chill from '../assets/mascot/chill.png'
import wink from '../assets/mascot/wink.png'
import avatar from '../assets/mascot/avatar.png'

export type MascotMood = 'idle' | 'happy' | 'busy' | 'confused' | 'chill' | 'wink' | 'avatar'

const SRC: Record<MascotMood, string> = { idle, happy, busy, confused, chill, wink, avatar }

const props = withDefaults(defineProps<{ mood?: MascotMood; size?: number }>(), { mood: 'idle', size: 120 })
const src = computed(() => SRC[props.mood])
</script>

<template>
  <div :class="['mascot', `m-${mood}`]" :style="{ height: size + 'px' }">
    <transition name="mascot-swap" mode="out-in">
      <img :key="mood" :src="src" :alt="mood" draggable="false" />
    </transition>
    <span v-if="mood === 'idle'" class="m-shadow"></span>
  </div>
</template>

<style scoped>
.mascot {
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  user-select: none;
}
.mascot img {
  height: 100%;
  width: auto;
  position: relative;
  z-index: 1;
  transform-origin: 50% 100%;
  animation: m-breathe 3.4s ease-in-out infinite;
  filter: drop-shadow(0 6px 10px rgba(255, 107, 154, 0.16));
}
.m-shadow {
  position: absolute;
  bottom: -4px;
  left: 50%;
  width: 46%;
  height: 8px;
  margin-left: -23%;
  border-radius: 50%;
  background: rgba(255, 107, 154, 0.16);
  animation: m-shadow 3.4s ease-in-out infinite;
}
.mascot:hover img {
  animation: m-boing 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.m-happy img { animation: m-jump 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) infinite; }
.m-busy img { animation: m-scribble 0.5s ease-in-out infinite alternate; }
.m-confused img { animation: m-tilt 2.4s ease-in-out infinite; }
.m-chill img { animation: m-sway 4s ease-in-out infinite; }
.m-wink img { animation: m-bob 1.6s ease-in-out infinite; }
.m-avatar img { animation: m-nod 3s ease-in-out infinite; transform-origin: 50% 80%; filter: none; }

.mascot-swap-enter-active { animation: m-pop-in 0.42s cubic-bezier(0.34, 1.56, 0.64, 1); }
.mascot-swap-leave-active { animation: m-pop-in 0.16s ease-in reverse; }

@keyframes m-breathe {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.015, 0.985) translateY(-1px); }
}
@keyframes m-shadow {
  0%, 100% { transform: scaleX(1); opacity: 1; }
  50% { transform: scaleX(0.92); opacity: 0.8; }
}
@keyframes m-boing {
  0% { transform: scale(1, 1); }
  30% { transform: scale(1.08, 0.9); }
  55% { transform: scale(0.95, 1.07) translateY(-6px); }
  80% { transform: scale(1.02, 0.98); }
  100% { transform: scale(1, 1); }
}
@keyframes m-jump {
  0%, 100% { transform: translateY(0) scale(1.02, 0.98); }
  45% { transform: translateY(-6%) scale(0.98, 1.02); }
}
@keyframes m-scribble {
  from { transform: rotate(-1.5deg); }
  to { transform: rotate(1.5deg) translateY(-1px); }
}
@keyframes m-tilt {
  0%, 100% { transform: rotate(0); }
  30% { transform: rotate(-5deg); }
  60% { transform: rotate(3deg); }
}
@keyframes m-sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2deg); }
}
@keyframes m-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes m-nod {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-6deg); }
  50% { transform: rotate(0); }
  75% { transform: rotate(5deg); }
}
@keyframes m-pop-in {
  from { opacity: 0; transform: scale(0.6) translateY(10px); }
  to { opacity: 1; transform: none; }
}
</style>
