<script setup lang="ts">
import UpdateSettings from './UpdateSettings.vue'

import AgentSettings from './AgentSettings.vue'

import { reportError } from '../../shared/lib/notifications'
import { settingsState } from './state'
import { skillsState } from '../skills/state'
import { tagState } from '../tags/state'
import { shellState } from '../../shared/state/shell'
import { reactive, ref, watch, computed, nextTick } from 'vue'
import { saveSettings } from './state'
import { refreshDb } from '../tags/state'
import { toast } from '../../shared/lib/notifications'
import Icon from '../../shared/ui/Icon.vue'
import SkillManager from '../skills/components/SkillManager.vue'

import type { ReasoningEffort } from '@shared/settings/types'

const form = reactive({
  apiKey: '',
  baseUrl: '',
  model: '',
  reasoningEffort: 'low' as ReasoningEffort,
  minPostCount: 10,
  translateMinCount: 50,
  naiToken: '',
  naiFreeOnly: true,
  mcpAllowAi: false,
  mcpAllowGenerate: false,
})
const editableKeys = Object.keys(form) as (keyof typeof form)[]
const skillManager = ref<InstanceType<typeof SkillManager>>()
function prepareUpdate(): void {
  skillManager.value?.prepareUpdate()
  if (
    filled &&
    settingsState.settings &&
    editableKeys.some((key) => String(form[key]) !== String(settingsState.settings![key]))
  ) {
    throw new Error('设置有尚未保存的修改，请先保存设置再重启更新')
  }
}
defineExpose({ prepareUpdate })
const efforts: { v: ReasoningEffort; label: string }[] = [
  { v: 'off', label: '关闭' },
  { v: 'low', label: '低' },
  { v: 'high', label: '高' },
  { v: 'max', label: '最高' },
]

// 只在首次拿到设置时填充表单；之后侧边栏切换版本等操作也会刷新 settingsState.settings，
// 若每次都覆盖会把用户尚未保存的输入（如刚填的 API Key）冲掉
let filled = false
watch(
  () => settingsState.settings,
  (settings) => {
    if (!settings || filled) {
      return
    }
    const { naiVersion: _v, inpaintVision: _legacyVision, ...rest } = settings
    Object.assign(form, rest)
    filled = true
  },
  { immediate: true },
)

const running = computed(
  () => !!tagState.progress && !['done', 'error'].includes(tagState.progress.stage),
)
const percent = computed(() => {
  const progress = tagState.progress
  return progress?.total ? Math.min(100, ((progress.current ?? 0) / progress.total) * 100) : 0
})

const cancel = () => window.api.cancelTask()

/* 从侧栏「管理 Skill」跳转过来时滚动到对应区块 */
watch(
  () => [shellState.tab, settingsState.settingsAnchor] as const,
  ([tab, anchor]) => {
    if (tab !== 'settings' || !anchor) {
      return
    }
    nextTick(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      settingsState.settingsAnchor = ''
    }).catch(reportError)
  },
  { immediate: true },
)

const naiInfo = ref('')

async function setMcp(key: 'mcpAllowAi' | 'mcpAllowGenerate', enabled: boolean) {
  form[key] = enabled
  await saveSettings({ [key]: enabled })
  toast(enabled ? '已开启，agent 下一次调用时生效' : '已关闭')
}

/* 开关类设置点了立即生效，和 MCP 开关保持一致；输入框类设置仍需点「保存」 */
async function setFreeOnly(enabled: boolean) {
  if (form.naiFreeOnly === enabled && settingsState.settings?.naiFreeOnly === enabled) {
    return
  }
  form.naiFreeOnly = enabled
  await saveSettings({ naiFreeOnly: enabled })
  if (enabled) {
    toast('已开启「只用免费额度」，不满足免费条件时不会提交')
  } else {
    toast('已允许消耗 Anlas，生成前请留意花费', {
      label: '撤销',
      run: () => void setFreeOnly(true).catch(reportError),
    })
  }
}
async function setEffort(effort: ReasoningEffort) {
  form.reasoningEffort = effort
  await saveSettings({ reasoningEffort: effort })
  toast(`思考模式：${efforts.find((effortOption) => effortOption.v === effort)?.label}，已保存`)
}

/* 各卡片的未保存修改：按钮旁标出，离开设置页时提醒 */
const differs = (...keys: (keyof typeof form)[]) =>
  !!settingsState.settings &&
  keys.some((field) => String(form[field]) !== String(settingsState.settings![field]))
const dirty = computed(() => ({
  data: differs('minPostCount'),
  deepseek: differs('apiKey', 'baseUrl', 'model'),
  nai: differs('naiToken'),
  translate: differs('translateMinCount'),
}))
const anyDirty = computed(() => Object.values(dirty.value).some(Boolean))
watch(
  () => shellState.tab,
  (tab, prev) => {
    if (prev === 'settings' && tab !== 'settings' && anyDirty.value) {
      toast('设置里还有未保存的修改，尚未生效', {
        label: '立即保存',
        run: () => void save().catch(reportError),
      })
    }
  },
)

async function testNai() {
  await save(true)
  naiInfo.value = '查询中…'
  try {
    const subscription = await window.api.naiSubscription()
    const anlas =
      subscription.anlasFixed !== undefined || subscription.anlasPurchased !== undefined
        ? (subscription.anlasFixed ?? 0) + (subscription.anlasPurchased ?? 0)
        : undefined
    const resolveValue2 = () => {
      if (subscription.active) {
        if (subscription.tier === 3) {
          return 'Opus 会员' as const
        }
        return `会员等级 ${subscription.tier ?? '未知'}`
      }
      return '没有有效订阅' as const
    }
    naiInfo.value = [
      resolveValue2(),
      anlas !== undefined && `Anlas ${anlas.toLocaleString()}`,
      subscription.usagePercent !== undefined && `V5 免费额度约 ${subscription.usagePercent}%`,
    ]
      .filter(Boolean)
      .join(' · ')
  } catch (error) {
    naiInfo.value = String(error).replace(
      /^Error: (Error invoking remote method '[^']+': )?(Error: )?/,
      '',
    )
  }
}

async function save(silent = false) {
  await saveSettings({
    ...form,
    minPostCount: Number(form.minPostCount),
    translateMinCount: Number(form.translateMinCount),
  })
  if (!silent) {
    toast('设置已保存')
  }
}

async function update() {
  await save(true)
  tagState.progress = { stage: 'tags', message: '开始下载…' }
  try {
    await window.api.dbUpdate()
  } catch {
    /* 错误通过 progress 显示 */
  }
  await refreshDb()
}

async function updateImplications() {
  tagState.progress = { stage: 'implications', message: '开始下载包含关系…' }
  try {
    await window.api.dbImplications()
  } catch {
    /* 错误通过 progress 显示 */
  }
  await refreshDb()
}

async function translate() {
  await save(true)
  if (!form.apiKey) {
    return toast('请先填写 API Key')
  }
  tagState.progress = { stage: 'ai-translate', message: '准备翻译…' }
  try {
    await window.api.aiTranslate()
  } catch {
    /* 同上 */
  }
  await refreshDb()
}
</script>

<template>
  <div class="view settings">
    <div
      class="card"
      style="--d: 0ms"
    >
      <div class="card-head">
        <span class="card-icon"><Icon name="tag" /></span>
        <div>
          <h2>Danbooru 数据</h2>
          <div class="card-desc">
            安装包已内置一份 tag 和中文翻译；点「更新」后会下载到本机用户目录，覆盖内置的数据
          </div>
        </div>
      </div>

      <div
        v-if="tagState.db"
        class="tiles"
      >
        <div class="tile">
          <div class="tile-num">{{ tagState.db.tagCount.toLocaleString() }}</div>
          <div class="tile-label">Tag</div>
        </div>
        <div class="tile">
          <div class="tile-num">{{ tagState.db.aliasCount.toLocaleString() }}</div>
          <div class="tile-label">别名</div>
        </div>
        <div class="tile">
          <div :class="['tile-num', { muted: !tagState.db.implicationCount }]">
            {{
              tagState.db.implicationCount
                ? tagState.db.implicationCount.toLocaleString()
                : '未下载'
            }}
          </div>
          <div class="tile-label">包含关系</div>
        </div>
        <div class="tile">
          <div class="tile-num">{{ tagState.db.zhCount.toLocaleString() }}</div>
          <div class="tile-label">已有中文</div>
        </div>
        <div class="tile">
          <div class="tile-num">{{ tagState.db.minCount ?? '—' }}</div>
          <div class="tile-label">收录阈值</div>
        </div>
        <div class="tile">
          <div class="tile-num sm">
            {{ tagState.db.fetchedAt ? new Date(tagState.db.fetchedAt).toLocaleDateString() : '—' }}
          </div>
          <div class="tile-label">
            {{ tagState.db.source === 'user' ? '自行更新' : '内置数据' }}
          </div>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-field">
          <label>最小引用数</label>
          <input
            v-model="form.minPostCount"
            class="input"
            type="number"
            min="1"
          />
          <span class="help"
            >只收录引用数 ≥ 该值的 tag。10 ≈ 15 万条，1 ≈ 50 万条（更慢）。点「下载 /
            更新」时自动保存</span
          >
        </div>
      </div>

      <div class="row">
        <button
          class="btn primary"
          :disabled="running"
          @click="update"
        >
          <Icon
            name="download"
            :size="16"
          />下载 / 更新 tag 数据
        </button>
        <button
          class="btn"
          :disabled="running || !tagState.db?.loaded"
          title="只下载包含关系，不重新下载 tag，约 1 分钟"
          @click="updateImplications"
        >
          <Icon
            name="swap"
            :size="15"
          />{{ tagState.db?.implicationCount ? '更新包含关系' : '下载包含关系' }}
        </button>
        <button
          v-if="running"
          class="btn ghost"
          @click="cancel"
        >
          <Icon
            name="stop"
            :size="15"
          />取消
        </button>
      </div>
      <span class="help">
        包含关系用于判断冗余（如 white thighhighs 已包含 thighhighs）。AI 优化和画面推测还会联网查
        Danbooru 的共现统计（角色默认外观、画师倾向），查过的结果会缓存 30 天，离线时自动降级。
      </span>

      <div
        v-if="tagState.progress"
        class="progress"
      >
        <div
          :class="[
            'progress-msg',
            { bad: tagState.progress.stage === 'error', ok: tagState.progress.stage === 'done' },
          ]"
        >
          <Icon
            v-if="tagState.progress.stage === 'done'"
            name="check"
            :size="15"
            :stroke="2.2"
          />
          <Icon
            v-else-if="tagState.progress.stage === 'error'"
            name="warn"
            :size="15"
          />
          <Icon
            v-else
            name="paw"
            :size="15"
            class="spin-slow"
          />
          {{ tagState.progress.message }}
        </div>
        <div
          v-if="running"
          :class="['bar', { indeterminate: !tagState.progress.total }]"
        >
          <div
            class="bar-in"
            :style="tagState.progress.total ? { width: percent + '%' } : {}"
          ></div>
        </div>
      </div>
    </div>

    <div
      class="card"
      style="--d: 70ms"
    >
      <div class="card-head">
        <span class="card-icon blue"><Icon name="key" /></span>
        <div>
          <h2>DeepSeek</h2>
          <div class="card-desc">用于 AI 优化、翻译和局部重绘分析，支持 OpenAI 兼容接口</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label>API Key</label>
          <input
            v-model="form.apiKey"
            class="input"
            type="password"
            data-mcp-private
            placeholder="sk-..."
          />
        </div>
        <div class="form-field">
          <label>Base URL</label>
          <input
            v-model="form.baseUrl"
            class="input"
          />
        </div>
        <div class="form-field">
          <label>模型</label>
          <input
            v-model="form.model"
            class="input"
          />
          <span class="help"
            >默认
            deepseek-flash，支持工具调用与图片理解；局部重绘直接复用此模型，无需额外配置。其他模型使用「图片
            + 批注」时需支持图片输入。</span
          >
        </div>
        <div class="form-field full">
          <label>思考模式</label>
          <div class="seg">
            <button
              v-for="option in efforts"
              :key="option.v"
              :class="{ on: form.reasoningEffort === option.v }"
              @click="setEffort(option.v)"
            >
              {{ option.label }}
            </button>
          </div>
          <span class="help"
            >只影响 AI 优化：思考越深，tag
            挑得越准，但也越慢。批量翻译固定关闭思考。点选后立即生效</span
          >
        </div>
      </div>
      <div class="row">
        <button
          class="btn primary"
          @click="save()"
        >
          <Icon
            name="check"
            :size="16"
          />保存
        </button>
        <span
          v-if="dirty.deepseek"
          class="pill alias"
          ><i></i>有未保存的修改</span
        >
      </div>
    </div>

    <SkillManager ref="skillManager" />

    <div
      class="card"
      style="--d: 105ms"
    >
      <div class="card-head">
        <span class="card-icon"><Icon name="image" /></span>
        <div>
          <h2>NovelAI</h2>
          <div class="card-desc">用于「生图预览」，直接调用 NovelAI 图像接口出图</div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label>Persistent API Token</label>
          <input
            v-model="form.naiToken"
            class="input"
            type="password"
            data-mcp-private
            placeholder="pst-..."
            autocomplete="off"
          />
          <span class="help"
            >在 NovelAI 网页「设置 → Account → Get Persistent API
            Token」获取。只保存在本机，只用于请求头</span
          >
        </div>
        <div class="form-field full">
          <label>只用免费额度</label>
          <div class="seg">
            <button
              :class="{ on: form.naiFreeOnly }"
              @click="setFreeOnly(true)"
            >
              开启（推荐）
            </button>
            <button
              :class="{ on: !form.naiFreeOnly }"
              @click="setFreeOnly(false)"
            >
              允许消耗 Anlas
            </button>
          </div>
          <span class="help">
            点选后立即生效。开启后：生成前检查 Opus 会员、免费额度、尺寸（≤ 1024×1024
            像素）和步数（≤ 28），不满足就不提交；每张生成后核对
            Anlas，发现扣除立即停止。这是调用端的检查，不是服务端保证
          </span>
        </div>
      </div>
      <div class="row">
        <button
          class="btn primary"
          @click="save()"
        >
          <Icon
            name="check"
            :size="16"
          />保存
        </button>
        <button
          class="btn"
          :disabled="!form.naiToken"
          @click="testNai"
        >
          <Icon
            name="key"
            :size="15"
          />保存并测试连接
        </button>
        <span
          v-if="dirty.nai"
          class="pill alias"
          ><i></i>Token 未保存</span
        >
        <span
          v-if="naiInfo"
          class="muted small"
          >{{ naiInfo }}</span
        >
      </div>
    </div>

    <AgentSettings
      :allow-ai="form.mcpAllowAi"
      :allow-generate="form.mcpAllowGenerate"
      @permission="setMcp"
      @manage-skills="skillsState.skillPanel = true"
    />

    <div
      class="card"
      style="--d: 140ms"
    >
      <div class="card-head">
        <span class="card-icon green"><Icon name="translate" /></span>
        <div>
          <h2>AI 补全中文翻译</h2>
          <div class="card-desc">
            社区词库没覆盖的 tag 交给 DeepSeek 翻译（画师 tag 不翻译），手动编辑的翻译优先级最高
          </div>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>最小引用数</label>
          <input
            v-model="form.translateMinCount"
            class="input"
            type="number"
            min="1"
          />
          <span class="help"
            >只翻译引用数 ≥ 该值的 tag，越小越多、越贵。点「开始 AI 翻译」时自动保存</span
          >
        </div>
      </div>
      <div class="row">
        <button
          class="btn primary"
          :disabled="running"
          @click="translate"
        >
          <Icon
            name="sparkle"
            :size="16"
          />开始 AI 翻译
        </button>
      </div>
    </div>

    <UpdateSettings />
  </div>
</template>
