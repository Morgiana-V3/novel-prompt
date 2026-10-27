<script setup lang="ts">
import { computed } from 'vue'
import idle from '../../assets/mascot/idle.png'
import happy from '../../assets/mascot/happy.png'
import busy from '../../assets/mascot/busy.png'
import confused from '../../assets/mascot/confused.png'
import chill from '../../assets/mascot/chill.png'
import wink from '../../assets/mascot/wink.png'
import avatar from '../../assets/mascot/avatar.png'
import reading from '../../assets/mascot/reading.png'
import think from '../../assets/mascot/think.png'
import paint from '../../assets/mascot/paint.png'
import oops from '../../assets/mascot/oops.png'
import sleep from '../../assets/mascot/sleep.png'
import search from '../../assets/mascot/search.png'
import shrug from '../../assets/mascot/shrug.png'
import point from '../../assets/mascot/point.png'
import key from '../../assets/mascot/key.png'
import thumbs from '../../assets/mascot/thumbs.png'
import ok from '../../assets/mascot/ok.png'
import check from '../../assets/mascot/check.png'
import crystal from '../../assets/mascot/crystal.png'

const SRC = {
  idle,
  happy,
  busy,
  confused,
  chill,
  wink,
  avatar,
  reading,
  think,
  paint,
  oops,
  sleep,
  search,
  shrug,
  point,
  key,
  thumbs,
  ok,
  check,
  crystal,
}

export type MascotMood = keyof typeof SRC

const props = withDefaults(defineProps<{ mood?: MascotMood; size?: number }>(), {
  mood: 'idle',
  size: 120,
})
const src = computed(() => SRC[props.mood])
</script>

<template>
  <div
    :class="['mascot', `m-${mood}`]"
    :style="{ height: size + 'px' }"
  >
    <transition
      name="mascot-swap"
      mode="out-in"
    >
      <img
        :key="mood"
        :src="src"
        :alt="mood"
        draggable="false"
      />
    </transition>
    <span
      v-if="mood === 'idle'"
      class="m-shadow"
    ></span>
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
  filter: drop-shadow(0 6px 10px rgb(255 107 154 / 16%));
}

.m-shadow {
  position: absolute;
  bottom: -4px;
  left: 50%;
  width: 46%;
  height: 8px;
  margin-left: -23%;
  border-radius: 50%;
  background: rgb(255 107 154 / 16%);
  animation: m-shadow 3.4s ease-in-out infinite;
}

.mascot:hover img {
  animation: m-boing 0.6s var(--bounce);
}

/* 高频情绪动作只播两次，之后回到呼吸，避免长时间停留在页面上时持续抖动 */
.m-happy img {
  animation:
    m-jump 0.9s var(--bounce) 2,
    m-breathe 3.4s ease-in-out 1.8s infinite;
}

.m-busy img {
  animation: m-scribble 0.5s ease-in-out infinite alternate;
}

.m-confused img {
  animation: m-tilt 2.4s ease-in-out infinite;
}

.m-chill img {
  animation: m-sway 4s ease-in-out infinite;
}

.m-wink img {
  animation: m-bob 1.6s ease-in-out infinite;
}

/* 侧栏常驻头像保持静止，只在悬停时回应 */
.m-avatar img {
  animation: none;
  transform-origin: 50% 80%;
  filter: none;
}

.m-avatar:hover img {
  animation: m-nod 1.2s ease-in-out;
}

.m-paint img {
  animation: m-scribble 0.6s ease-in-out infinite alternate;
}

.m-reading img,
.m-sleep img {
  animation: m-breathe 4.6s ease-in-out infinite;
}

.m-think img,
.m-shrug img {
  animation: m-tilt 3s ease-in-out infinite;
}

.m-oops img {
  animation:
    m-shake 0.5s ease-in-out 2,
    m-breathe 3.4s ease-in-out 1s infinite;
}

.m-search img,
.m-crystal img {
  animation: m-sway 3.6s ease-in-out infinite;
}

.m-point img,
.m-key img,
.m-ok img,
.m-check img {
  animation: m-bob 1.8s ease-in-out infinite;
}

.m-thumbs img {
  animation:
    m-jump 1.2s var(--bounce) 2,
    m-breathe 3.4s ease-in-out 2.4s infinite;
}

.mascot-swap-enter-active {
  animation: m-pop-in var(--dur-emph) var(--bounce);
}

.mascot-swap-leave-active {
  animation: m-pop-in 0.16s ease-in reverse;
}

@keyframes m-breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }

  50% {
    transform: scale(1.015, 0.985) translateY(-1px);
  }
}

@keyframes m-shadow {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 1;
  }

  50% {
    transform: scaleX(0.92);
    opacity: 0.8;
  }
}

@keyframes m-boing {
  0% {
    transform: scale(1, 1);
  }

  30% {
    transform: scale(1.08, 0.9);
  }

  55% {
    transform: scale(0.95, 1.07) translateY(-6px);
  }

  80% {
    transform: scale(1.02, 0.98);
  }

  100% {
    transform: scale(1, 1);
  }
}

@keyframes m-jump {
  0%,
  100% {
    transform: translateY(0) scale(1.02, 0.98);
  }

  45% {
    transform: translateY(-6%) scale(0.98, 1.02);
  }
}

@keyframes m-scribble {
  from {
    transform: rotate(-1.5deg);
  }

  to {
    transform: rotate(1.5deg) translateY(-1px);
  }
}

@keyframes m-tilt {
  0%,
  100% {
    transform: rotate(0);
  }

  30% {
    transform: rotate(-5deg);
  }

  60% {
    transform: rotate(3deg);
  }
}

@keyframes m-sway {
  0%,
  100% {
    transform: rotate(-2deg);
  }

  50% {
    transform: rotate(2deg);
  }
}

@keyframes m-bob {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4px);
  }
}

@keyframes m-nod {
  0%,
  100% {
    transform: rotate(0);
  }

  25% {
    transform: rotate(-6deg);
  }

  50% {
    transform: rotate(0);
  }

  75% {
    transform: rotate(5deg);
  }
}

@keyframes m-shake {
  0%,
  100% {
    transform: translateX(0) rotate(0);
  }

  25% {
    transform: translateX(-2px) rotate(-1.5deg);
  }

  75% {
    transform: translateX(2px) rotate(1.5deg);
  }
}

@keyframes m-pop-in {
  from {
    opacity: 0;
    transform: scale(0.6) translateY(10px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}
</style>
