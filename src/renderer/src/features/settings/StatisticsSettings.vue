<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  addTotals,
  emptyTotals,
  type StatisticsData,
  type StatisticsTotals,
} from '@shared/statistics/model'
import { TASK_LABELS, type TaskKind } from '@shared/tasks/model'
import { taskState } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'
import ConfirmDialog from '../../shared/ui/ConfirmDialog.vue'
const props = defineProps<{ active: boolean; compact?: boolean }>()
defineEmits<{ open: [] }>()
const data = ref<StatisticsData>()
const error = ref('')
const busy = ref(false)
const confirming = ref(false)
const period = ref(30)
const metric = ref<'total' | 'images' | 'runs' | 'anlasSpent'>('total')
const selected = ref('')
const metricOptions = [
  { key: 'total', label: 'Token' },
  { key: 'images', label: '图片' },
  { key: 'anlasSpent', label: 'Anlas' },
  { key: 'runs', label: '功能任务' },
] as const
function setPeriod(value: number) {
  period.value = value
  selected.value = ''
}
let epoch = 0
let timer: ReturnType<typeof setTimeout> | undefined
const n = (value: number) => value.toLocaleString('zh-CN')
const dateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
async function refresh() {
  const request = ++epoch
  try {
    const result = await window.api.statisticsGet()
    if (request === epoch) {
      data.value = result
      error.value = result.error ?? ''
    }
  } catch (reason) {
    if (request === epoch) {
      error.value = cleanErr(reason)
    }
  }
}
watch(
  () => [props.active, taskState.revision],
  () => {
    clearTimeout(timer)
    if (props.active && !busy.value) {
      timer = setTimeout(() => {
        refresh().catch((reason) => {
          error.value = cleanErr(reason)
        })
      }, 150)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  epoch++
})
async function clear() {
  confirming.value = false
  busy.value = true
  epoch++
  clearTimeout(timer)
  try {
    data.value = await window.api.statisticsClear()
    error.value = ''
    selected.value = ''
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    busy.value = false
  }
}
const totals = computed(() => {
  const sum = emptyTotals()
  for (const day of data.value?.days ?? []) {
    addTotals(sum, day.totals)
  }
  return sum
})
const days = computed(() => {
  const now = new Date()
  return Array.from({ length: period.value }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - period.value + 1 + i)
    const key = dateKey(date)
    return {
      date: key,
      totals: data.value?.days.find((day) => day.date === key)?.totals ?? emptyTotals(),
    }
  })
})
const maximum = computed(() => Math.max(1, ...days.value.map((day) => day.totals[metric.value])))
const label = computed(
  () => ({ total: 'Token', images: '图片', runs: '功能任务', anlasSpent: 'Anlas' })[metric.value],
)
const dayDetail = computed(
  () => days.value.find((day) => day.date === selected.value) ?? days.value.at(-1)!,
)
const models = computed(() => {
  const rows = new Map<string, { provider: string; model: string; totals: StatisticsTotals }>()
  for (const day of data.value?.days ?? []) {
    for (const model of day.models) {
      const key = JSON.stringify([model.provider, model.model])
      if (!rows.has(key)) {
        rows.set(key, { ...model, totals: emptyTotals() })
      }
      addTotals(rows.get(key)!.totals, model.totals)
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.totals.total - a.totals.total || b.totals.images - a.totals.images,
  )
})
const features = computed(() => {
  const counts = new Map<string, number>()
  const dates = new Set(days.value.map((day) => day.date))
  for (const day of data.value?.days ?? []) {
    if (!dates.has(day.date)) {
      continue
    }
    for (const [key, value] of Object.entries(day.features)) {
      counts.set(key, (counts.get(key) ?? 0) + value.runs)
    }
  }
  return [...counts]
    .filter(([, count]) => count)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count, label: TASK_LABELS[key as TaskKind] ?? '其他操作' }))
})
</script>
<template>
  <div
    v-if="compact"
    class="statistics-summary"
  >
    <span
      >累计 Token <b>{{ n(totals.total) }}</b></span
    >
    <button
      class="btn ghost small"
      @click="$emit('open')"
    >
      查看统计 →
    </button>
    <small v-if="error">{{ error }}</small>
    <small v-else-if="totals.requests > totals.reported"
      >{{ totals.requests - totals.reported }} 次请求未完整返回用量</small
    >
  </div>
  <div
    v-else
    class="statistics-settings"
  >
    <header class="statistics-header">
      <div>
        <h2>使用统计</h2>
        <p v-if="data">自 {{ new Date(data.startedAt).toLocaleString('zh-CN') }} 开始记录</p>
      </div>
      <div class="row">
        <button
          class="btn ghost small"
          :disabled="busy"
          @click="refresh"
        >
          刷新</button
        ><button
          class="btn ghost small"
          :disabled="busy"
          @click="confirming = true"
        >
          清空统计
        </button>
      </div>
    </header>
    <p
      v-if="error"
      class="statistics-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="statistics-counters">
      <div>
        <span>累计 Token</span><strong>{{ n(totals.total) }}</strong
        ><small>输入 {{ n(totals.input) }} · 输出 {{ n(totals.output) }}</small>
      </div>
      <div>
        <span>NovelAI 积分扣减</span
        ><strong>{{ totals.anlasMeasured ? n(totals.anlasSpent) : '—' }}</strong
        ><small>Anlas · 生图前后余额核对</small>
      </div>
      <div>
        <span>生成图片</span><strong>{{ n(totals.images) }}</strong
        ><small>含重绘与批次已完成图片</small>
      </div>
      <div>
        <span>功能任务</span><strong>{{ n(totals.runs) }}</strong
        ><small
          >完成 {{ n(totals.completed) }} · 失败 {{ n(totals.failed) }} · 取消
          {{ n(totals.cancelled) }}</small
        >
      </div>
    </div>
    <p class="statistics-note">
      缓存命中 {{ totals.cacheReported ? n(totals.cached) : '—' }} Token，已含在输入用量中。 Anlas
      已核对 {{ n(totals.anlasMeasured) }} 张，{{ n(totals.anlasUnknown) }}
      张未能核对；积分开始记录前的图片不补算。余额差可能受官网同时使用或充值影响。
    </p>
    <p
      v-if="totals.requests > totals.reported"
      class="statistics-note"
    >
      {{ n(totals.requests - totals.reported) }} /
      {{ n(totals.requests) }} 次接口请求未完整返回用量；已知用量仍计入，未知部分不估算。
    </p>
    <section class="statistics-section">
      <div class="statistics-toolbar">
        <h3>每日趋势</h3>
        <div class="seg">
          <button
            v-for="value in [7, 30, 90]"
            :key="value"
            :class="{ on: period === value }"
            @click="setPeriod(value)"
          >
            {{ value }} 天
          </button>
        </div>
      </div>
      <div class="statistics-toolbar">
        <div class="seg">
          <button
            v-for="item in metricOptions"
            :key="item.key"
            :class="{ on: metric === item.key }"
            @click="metric = item.key"
          >
            {{ item.label }}
          </button>
        </div>
        <span class="muted small"
          >最高 {{ n(maximum === 1 && !days.some((day) => day.totals[metric]) ? 0 : maximum) }}
          {{ label }}</span
        >
      </div>
      <div
        class="statistics-chart"
        :aria-label="`每日${label}趋势`"
      >
        <button
          v-for="day in days"
          :key="day.date"
          :aria-label="`${day.date}：${day.totals[metric]} ${label}`"
          :aria-pressed="dayDetail.date === day.date"
          :title="`${day.date} · ${n(day.totals[metric])} ${label}`"
          @click="selected = day.date"
        >
          <i
            :style="{
              height: `${Math.max(day.totals[metric] ? 2 : 0, (day.totals[metric] / maximum) * 100)}%`,
            }"
          ></i>
        </button>
      </div>
      <div class="statistics-axis">
        <span>{{ days[0].date }}</span
        ><span>{{ days.at(-1)!.date }}</span>
      </div>
      <div class="statistics-day">
        <b>{{ dayDetail.date }}</b
        ><span>Token {{ n(dayDetail.totals.total) }}</span
        ><span>图片 {{ n(dayDetail.totals.images) }}</span
        ><span
          >Anlas {{ dayDetail.totals.anlasMeasured ? n(dayDetail.totals.anlasSpent) : '—' }}</span
        ><span>任务 {{ n(dayDetail.totals.runs) }}</span>
      </div>
    </section>
    <section class="statistics-section">
      <h3>功能使用 · 最近 {{ period }} 天</h3>
      <p
        v-if="!features.length"
        class="muted small"
      >
        还没有任务记录
      </p>
      <div
        v-for="feature in features"
        :key="feature.key"
        class="statistics-feature"
      >
        <span>{{ feature.label }}</span>
        <div><i :style="{ width: `${(feature.count / features[0].count) * 100}%` }"></i></div>
        <b>{{ n(feature.count) }}</b>
      </div>
    </section>
    <section class="statistics-section">
      <h3>模型累计用量</h3>
      <div class="statistics-table">
        <table>
          <thead>
            <tr>
              <th>模型 / 接口</th>
              <th>输入</th>
              <th>输出</th>
              <th>缓存命中</th>
              <th>总 Token</th>
              <th>图片</th>
              <th>Anlas</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="model in models"
              :key="`${model.provider}/${model.model}`"
            >
              <td>
                {{ model.model }}<small>{{ model.provider }}</small>
              </td>
              <td>{{ n(model.totals.input) }}</td>
              <td>{{ n(model.totals.output) }}</td>
              <td>{{ model.totals.cacheReported ? n(model.totals.cached) : '—' }}</td>
              <td>{{ n(model.totals.total) }}</td>
              <td>{{ n(model.totals.images) }}</td>
              <td>{{ model.totals.anlasMeasured ? n(model.totals.anlasSpent) : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p
          v-if="!models.length"
          class="muted small"
        >
          还没有模型用量记录
        </p>
      </div>
    </section>
    <p class="statistics-note">
      按本机日期统计本软件内置接口返回的用量；历史未记录用量、外部 Agent
      消耗不在统计范围内。功能次数按结束的任务统计。仅保存本地计数，不保存提示词或密钥。
    </p>
    <ConfirmDialog
      v-if="confirming"
      title="清空使用统计"
      message="累计用量、每日趋势和功能次数将重新开始记录。图片、提示词、设置和任务记录不受影响。"
      confirm-label="清空统计"
      danger
      @confirm="clear"
      @cancel="confirming = false"
    />
  </div>
</template>
<style scoped>
.statistics-settings {
  display: grid;
  gap: 22px;
  padding: 24px;
  max-width: 1120px;
}

.statistics-header,
.statistics-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.statistics-settings h2,
.statistics-settings h3,
.statistics-settings p {
  margin: 0;
}

.statistics-header h2 {
  font-size: 20px;
}

.statistics-header p,
.statistics-note,
.statistics-axis {
  font-size: 11px;
  color: var(--text2);
}

.statistics-header p {
  margin-top: 6px;
}

.statistics-counters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.statistics-counters > div {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 2px solid var(--line);
}

.statistics-counters span {
  color: var(--text2);
  font-size: 12px;
}

.statistics-counters strong {
  font-size: 27px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.statistics-counters small {
  color: var(--text2);
  font-size: 10px;
}

.statistics-section {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.statistics-section h3 {
  font-size: 14px;
}

.statistics-chart {
  display: flex;
  gap: 3px;
  height: 150px;
  border-bottom: 1px solid var(--line);
  padding-top: 10px;
}

.statistics-chart button {
  display: flex;
  align-items: flex-end;
  flex: 1;
  min-width: 0;
  padding: 0;
  height: 100%;
  background: var(--panel);
}

.statistics-chart i {
  display: block;
  width: 100%;
  background: var(--pink);
  border-radius: 3px 3px 0 0;
  opacity: 0.65;
}

.statistics-chart button:hover i,
.statistics-chart button[aria-pressed='true'] i {
  opacity: 1;
}

.statistics-chart button:focus-visible {
  outline: 2px solid var(--pink);
  outline-offset: 2px;
}

.statistics-axis {
  display: flex;
  justify-content: space-between;
}

.statistics-day {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  padding: 10px 0;
}

.statistics-feature {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 50px;
  gap: 12px;
  align-items: center;
  font-size: 12px;
}

.statistics-feature > div {
  height: 6px;
  background: var(--panel);
}

.statistics-feature i {
  display: block;
  height: 100%;
  background: var(--pink);
  border-radius: 3px;
}

.statistics-feature b {
  text-align: right;
}

.statistics-table {
  overflow-x: auto;
}

.statistics-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.statistics-table th,
.statistics-table td {
  padding: 10px 8px;
  text-align: right;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.statistics-table th:first-child,
.statistics-table td:first-child {
  text-align: left;
}

.statistics-table small {
  display: block;
  color: var(--text2);
  font-size: 10px;
  margin-top: 4px;
}

.statistics-note {
  line-height: 1.7;
}

.statistics-error {
  color: var(--bad);
  font-size: 12px;
}

.statistics-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}

.statistics-summary small {
  color: var(--text2);
}

@media (width < 1200px) {
  .statistics-counters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
