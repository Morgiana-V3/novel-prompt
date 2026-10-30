<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { taskIsActive } from '@shared/tasks/model'
import { settingsState } from '../../settings/state'
import { shellState } from '../../../shared/state/shell'
import { taskState } from '../../../shared/state/tasks'
import Icon from '../../../shared/ui/Icon.vue'
import { reportError } from '../../../shared/lib/notifications'
import { imageState } from '../state'
import { refreshSubscription, resetSubscription, subscriptionState } from '../subscription'

const hasToken = computed(() => !!settingsState.settings?.naiToken?.trim())
const subscription = computed(() => subscriptionState.subscription)
const freeOnly = computed(() => settingsState.settings?.naiFreeOnly !== false)
const isV5 = computed(() => settingsState.settings?.naiVersion === 'v5')
const label = computed(() => {
  if (!hasToken.value) {
    return '连接 NovelAI'
  }
  if (!subscription.value) {
    return subscriptionState.error ? '账户读取失败' : '正在读取账户…'
  }
  if (subscription.value.active === false) {
    return '订阅已失效'
  }
  if (subscription.value.tier === 3) {
    return 'Opus 会员'
  }
  return subscription.value.tier === undefined
    ? 'NovelAI 账户'
    : `会员等级 ${subscription.value.tier}`
})
const balance = computed(() => {
  const account = subscription.value
  if (!account || (account.anlasFixed === undefined && account.anlasPurchased === undefined)) {
    return null
  }
  return (account.anlasFixed ?? 0) + (account.anlasPurchased ?? 0)
})
const anlas = computed(() => balance.value?.toLocaleString() ?? '—')
const balanceNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [settingsState.settings?.naiToken, balance.value] as const,
  ([token, amount], [previousToken, previousAmount]) => {
    if (token !== previousToken || amount === null) {
      clearTimeout(noticeTimer)
      balanceNotice.value = ''
      return
    }
    if (previousAmount === null || amount === previousAmount) {
      return
    }
    const change = amount - previousAmount
    balanceNotice.value =
      change < 0
        ? `本次消耗 ${(-change).toLocaleString()} Anlas`
        : `余额增加 ${change.toLocaleString()} Anlas`
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      balanceNotice.value = ''
    }, 4000)
  },
)
const recovery = computed(() => {
  const seconds = subscription.value?.usageNextSeconds
  if (!seconds) {
    return undefined
  }
  const duration =
    seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} 小时` : `${Math.ceil(seconds / 60)} 分钟`
  return `约 ${duration}后恢复 1%`
})
function openSettings() {
  settingsState.settingsAnchor = 'nai'
  shellState.tab = 'settings'
}
watch(
  () => settingsState.settings?.naiToken,
  () => {
    resetSubscription()
    refreshSubscription().catch(reportError)
  },
  { immediate: true },
)
watch(
  () =>
    taskState.tasks
      .filter(
        (task) =>
          ['generate', 'inpaint', 'page-generate'].includes(task.kind) && !taskIsActive(task),
      )
      .map((task) => `${task.id}:${task.status}`)
      .sort()
      .join(','),
  (completed, previous) => {
    const known = new Set(previous.split(','))
    if (completed.split(',').some((task) => task && !known.has(task))) {
      refreshSubscription(true).catch(reportError)
    }
  },
)
watch(
  () => imageState.generating,
  (running, previous) => {
    if (previous && !running) {
      refreshSubscription(true).catch(reportError)
    }
  },
)
function refreshOnFocus() {
  if (Date.now() - subscriptionState.updatedAt > 60_000) {
    refreshSubscription().catch(reportError)
  }
}
onMounted(() => window.addEventListener('focus', refreshOnFocus))
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshOnFocus)
  clearTimeout(noticeTimer)
})
</script>

<template>
  <section
    class="subscription-status"
    aria-label="NovelAI 账户"
  >
    <Transition name="balance-notice">
      <div
        v-if="balanceNotice"
        class="balance-notice"
        role="status"
      >
        {{ balanceNotice }}
      </div>
    </Transition>
    <header>
      <Icon
        name="key"
        :size="14"
      />
      <strong>{{ label }}</strong>
      <button
        v-if="hasToken"
        class="icon-btn sm"
        :disabled="subscriptionState.loading"
        aria-label="刷新会员与余额"
        title="刷新会员与余额"
        @click="refreshSubscription()"
      >
        <Icon
          name="swap"
          :size="14"
          :class="{ spin: subscriptionState.loading }"
        />
      </button>
      <button
        v-else
        class="icon-btn sm"
        aria-label="配置 NovelAI Token"
        title="配置 NovelAI Token"
        @click="openSettings"
      >
        <Icon
          name="sliders"
          :size="14"
        />
      </button>
    </header>
    <template v-if="hasToken">
      <div class="subscription-row">
        <span>Anlas</span><b>{{ anlas }}</b>
      </div>
      <div
        v-if="isV5"
        class="subscription-row"
        :title="recovery"
      >
        <span>V5 免费额度</span
        ><b
          >{{ subscription?.usagePercent === undefined ? '—' : `${subscription.usagePercent}%`
          }}{{ subscription?.usageNegative ? '（负值）' : '' }}</b
        >
      </div>
      <div
        v-if="subscriptionState.error"
        class="subscription-error"
        :title="subscriptionState.error"
        role="status"
      >
        {{ subscription ? '刷新失败 · 显示上次数据' : '读取失败，请重试' }}
      </div>
      <button
        class="subscription-mode"
        title="在设置中修改额度使用方式"
        @click="openSettings"
      >
        {{ freeOnly ? '只用免费额度' : '允许消耗 Anlas' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.subscription-status {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  font-size: 12px;
}

.balance-notice {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--pink-line);
  border-radius: 10px;
  color: var(--pink-deep);
  background: var(--bg);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  pointer-events: none;
}

.balance-notice-enter-active,
.balance-notice-leave-active {
  transition:
    opacity var(--dur-fast),
    transform var(--dur-fast);
}

.balance-notice-enter-from,
.balance-notice-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

header > .icon {
  color: var(--pink-deep);
  flex-shrink: 0;
}

header strong {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}

.subscription-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  color: var(--text2);
}

.subscription-row b {
  color: var(--text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.subscription-mode {
  align-self: flex-start;
  padding: 0;
  color: var(--muted);
  font-size: 11px;
}

.subscription-mode:hover {
  color: var(--pink-deep);
}

.subscription-error {
  color: var(--bad);
  font-size: 11px;
}
</style>
