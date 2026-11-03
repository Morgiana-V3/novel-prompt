<script setup lang="ts">
import StorageSettings from './StorageSettings.vue'
import StatisticsSettings from './StatisticsSettings.vue'
import { AI_PRESETS, type AiPreset } from '@shared/settings/ai-presets'
import HelpTip from '../../shared/ui/HelpTip.vue'
import UpdateSettings from './UpdateSettings.vue'

import AgentSettings from './AgentSettings.vue'

import { reportError } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { settingsState } from './state'
import { skillsState } from '../skills/state'
import { tagState } from '../tags/state'
import { shellState } from '../../shared/state/shell'
import { reactive, ref, watch, computed, nextTick } from 'vue'
import { saveSettings } from './state'
import { refreshSubscription, subscriptionState } from '../generation/subscription'
import { refreshDb } from '../tags/state'
import { toast } from '../../shared/lib/notifications'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import SkillManager from '../skills/components/SkillManager.vue'

import type { ReasoningEffort } from '@shared/settings/types'

const categories = [
  { id: 'tags', label: 'Tag 词库', icon: 'tag' },
  { id: 'services', label: 'AI 服务', icon: 'sparkle' },
  { id: 'statistics', label: '使用统计', icon: 'tasks' },
  { id: 'other', label: '存储与更新', icon: 'folder' },
] as const
const services = [
  { id: 'nai', label: 'NovelAI' },
  { id: 'ai', label: '模型接口' },
  { id: 'skills', label: 'Skill' },
  { id: 'agent', label: 'Agent' },
] as const
type SettingsCategory = (typeof categories)[number]['id']
type AiService = (typeof services)[number]['id']
type SettingsSection = SettingsCategory | AiService
const category = ref<SettingsCategory>('tags')
const service = ref<AiService>('nai')
const content = ref<HTMLElement>()
const anchors: Record<string, SettingsSection> = {
  nai: 'nai',
  deepseek: 'ai',
  ai: 'ai',
  'skill-manager': 'skills',
  tags: 'tags',
  agent: 'agent',
  storage: 'other',
  updates: 'other',
  statistics: 'statistics',
}
function selectCategory(id: SettingsCategory) {
  category.value = id
  if (content.value) {
    content.value.scrollTop = 0
  }
}
function selectService(id: AiService) {
  service.value = id
  selectCategory('services')
}
function selectSection(id: SettingsSection) {
  if (id === 'nai' || id === 'ai' || id === 'agent' || id === 'skills') {
    selectService(id)
  } else {
    selectCategory(id)
  }
}
function navigateCategory(event: KeyboardEvent, index: number, nested = false) {
  const options = nested ? services : categories
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (index + 1) % options.length
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (index + options.length - 1) % options.length
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = options.length - 1
  } else {
    return
  }
  event.preventDefault()
  selectSection(options[next].id)
  const navigation = (event.currentTarget as HTMLElement).parentElement
  navigation?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
}

const form = reactive({
  aiPreset: 'custom' as AiPreset,
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
const presetDrafts = new Map<AiPreset, { apiKey: string; baseUrl: string; model: string }>()
const modelSuggestions = computed(() => {
  if (form.aiPreset === 'custom') {
    return AI_PRESETS.filter((item) => item.models.length)
  }
  const preset = AI_PRESETS.find((item) => item.id === form.aiPreset)
  return preset ? [preset] : []
})
const presetOptions = AI_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))
/** 常用模型只是快捷填入：选中后写入模型输入框，自身始终显示占位文字 */
const modelOptions = computed(() => [
  { value: '', label: '常用模型', disabled: true },
  ...modelSuggestions.value.flatMap((preset) =>
    preset.models.map((model) => ({
      value: model,
      label: modelSuggestions.value.length > 1 ? `${preset.label} · ${model}` : model,
    })),
  ),
])
function chooseModel(model: string) {
  if (model) {
    form.model = model
  }
}
function choosePreset(next: AiPreset) {
  const preset = AI_PRESETS.find((item) => item.id === next)
  if (!preset || next === form.aiPreset) {
    return
  }
  const current = { apiKey: form.apiKey, baseUrl: form.baseUrl, model: form.model }
  presetDrafts.set(form.aiPreset, current)
  const draft =
    presetDrafts.get(next) ??
    (next === 'custom'
      ? current
      : {
          apiKey: '',
          baseUrl: preset.baseUrl,
          model: preset.model,
        })
  Object.assign(form, draft, { aiPreset: next })
}
const deepSeekProvider = computed(
  () => /deepseek/i.test(form.baseUrl) || /^deepseek/i.test(form.model),
)
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

// Only copy editable scalar fields. Nested settings become Vue proxies and cannot cross IPC.
// Refresh pristine fields while preserving drafts when another settings control saves.
let filled = false
watch(
  () => settingsState.settings,
  (settings, previous) => {
    if (!settings) {
      return
    }
    for (const key of editableKeys) {
      if (!filled || (previous && form[key] === previous[key])) {
        Object.assign(form, { [key]: settings[key] })
      }
    }
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

/* Deep links select the category before revealing their target. */
watch(
  () => [shellState.tab, settingsState.settingsAnchor] as const,
  async ([tab, anchor]) => {
    if (tab !== 'settings' || !anchor) {
      return
    }
    selectSection(anchors[anchor] ?? 'tags')
    await nextTick()
    document.getElementById(anchor)?.scrollIntoView({ block: 'nearest' })
    settingsState.settingsAnchor = ''
  },
  { immediate: true },
)

const naiInfo = ref('')
const naiError = ref('')
const naiBusy = ref(false)
watch(
  () => form.naiToken,
  () => {
    naiInfo.value = ''
    naiError.value = ''
  },
)

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

/* Preserve drafts across both navigation levels and mark their categories. */
const differs = (...keys: (keyof typeof form)[]) =>
  !!settingsState.settings &&
  keys.some((field) => String(form[field]) !== String(settingsState.settings![field]))
const dirty = computed(() => ({
  data: differs('minPostCount'),
  deepseek: differs('apiKey', 'baseUrl', 'model', 'aiPreset'),
  nai: differs('naiToken'),
  translate: differs('translateMinCount'),
}))
function categoryDirty(id: SettingsSection) {
  if (id === 'services') {
    return dirty.value.nai || dirty.value.deepseek
  }
  if (id === 'nai') {
    return dirty.value.nai
  }
  if (id === 'ai') {
    return dirty.value.deepseek
  }
  if (id === 'tags') {
    return dirty.value.data || dirty.value.translate
  }
  return false
}
async function saveCategory(id: 'ai' | 'tags', silent = false) {
  const patch =
    id === 'ai'
      ? { apiKey: form.apiKey, baseUrl: form.baseUrl, model: form.model, aiPreset: form.aiPreset }
      : {
          minPostCount: Number(form.minPostCount),
          translateMinCount: Number(form.translateMinCount),
        }
  await saveSettings(patch)
  if (!silent) {
    toast('本页设置已保存')
  }
}
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

async function saveNai(testConnection = false, clearToken = false) {
  if (naiBusy.value) {
    return
  }
  const draftToken = form.naiToken
  const token = clearToken ? '' : draftToken.trim()
  naiBusy.value = true
  naiInfo.value = ''
  naiError.value = ''
  let saved = false
  try {
    await saveSettings({ naiToken: token })
    saved = true
    if (form.naiToken === draftToken) {
      form.naiToken = token
    }
    toast(token ? 'NovelAI Token 已保存' : '已清除本机保存的 NovelAI Token')
    if (testConnection && token) {
      naiInfo.value = '查询中…'
      await refreshSubscription()
      if (subscriptionState.error) {
        throw new Error(subscriptionState.error)
      }
      naiInfo.value = '连接成功'
    }
  } catch (error) {
    naiInfo.value = ''
    const message = cleanErr(error)
    const safeMessage = token ? message.split(token).join('[已隐藏]') : message
    naiError.value = `${saved ? 'Token 已保存，连接测试失败' : '保存失败'}：${safeMessage}`
    toast(saved ? 'Token 已保存，但连接测试失败' : 'Token 保存失败，请查看错误信息')
  } finally {
    naiBusy.value = false
  }
}

async function save(silent = false) {
  await saveSettings({
    ...Object.fromEntries(editableKeys.map((key) => [key, form[key]])),
    minPostCount: Number(form.minPostCount),
    translateMinCount: Number(form.translateMinCount),
  })
  if (!silent) {
    toast('设置已保存')
  }
}

async function update() {
  await saveCategory('tags', true)
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
  if (!settingsState.settings?.apiKey) {
    selectService('ai')
    return toast('请先配置并保存 AI 服务')
  }
  await saveCategory('tags', true)
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
  <div class="view settings settings-categorized">
    <header class="settings-navigation">
      <div
        class="settings-tabs"
        role="tablist"
        aria-label="设置分类"
      >
        <button
          v-for="(item, index) in categories"
          :id="`settings-tab-${item.id}`"
          :key="item.id"
          role="tab"
          :aria-selected="category === item.id"
          :aria-controls="`settings-panel-${item.id}`"
          :tabindex="category === item.id ? 0 : -1"
          :title="categoryDirty(item.id) ? '有未保存的修改' : undefined"
          @click="selectCategory(item.id)"
          @keydown="navigateCategory($event, index)"
        >
          <Icon
            :name="item.icon"
            :size="15"
          />{{ item.label
          }}<span
            v-if="categoryDirty(item.id)"
            class="settings-dirty-dot"
            aria-label="有未保存的修改"
          ></span>
        </button>
      </div>
      <div
        class="settings-services-nav"
        :class="{ open: category === 'services' }"
        :inert="category !== 'services'"
        role="tablist"
        aria-label="AI 服务分类"
      >
        <div class="settings-services-list">
          <button
            v-for="(item, index) in services"
            :id="`settings-service-${item.id}`"
            :key="item.id"
            role="tab"
            :aria-selected="service === item.id"
            :aria-controls="`settings-panel-${item.id}`"
            :tabindex="service === item.id ? 0 : -1"
            @click="selectService(item.id)"
            @keydown="navigateCategory($event, index, true)"
          >
            {{ item.label
            }}<span
              v-if="categoryDirty(item.id)"
              class="settings-dirty-dot"
              aria-label="有未保存的修改"
            ></span>
          </button>
        </div>
      </div>
    </header>
    <div
      ref="content"
      class="settings-content scroll"
    >
      <section
        v-show="category === 'tags'"
        id="settings-panel-tags"
        role="tabpanel"
        aria-labelledby="settings-tab-tags"
        tabindex="0"
        class="settings-panel"
      >
        <div
          class="card"
          style="--d: 0ms"
        >
          <div class="card-head">
            <span class="card-icon"><Icon name="tag" /></span>
            <div>
              <h2>Danbooru 数据</h2>
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
              <div class="tile-num">{{ (tagState.db.implicationCount ?? 0).toLocaleString() }}</div>
              <div class="tile-label">包含关系</div>
            </div>
            <div class="tile">
              <div class="tile-num">{{ tagState.db.zhCount.toLocaleString() }}</div>
              <div class="tile-label">已有中文</div>
            </div>
          </div>
          <div
            v-if="tagState.db"
            class="data-meta"
          >
            <span>当前收录阈值 ≥ {{ tagState.db.minCount ?? '—' }}</span>
            <span
              >{{ tagState.db.source === 'user' ? '自行更新' : '内置数据' }} ·
              {{
                tagState.db.fetchedAt
                  ? new Date(tagState.db.fetchedAt).toLocaleDateString()
                  : '日期未知'
              }}</span
            >
          </div>

          <div class="form-field">
            <label for="settings-min-post">最小引用数</label>
            <div class="inline-field">
              <input
                id="settings-min-post"
                v-model="form.minPostCount"
                class="input number-input"
                type="number"
                min="1"
              />
              <Transition name="fade">
                <button
                  v-if="categoryDirty('tags')"
                  class="btn small tags-save"
                  @click="saveCategory('tags').catch(reportError)"
                >
                  保存词库设置
                </button>
              </Transition>
              <span class="help">低于该引用数的 tag 不会下载，数值越小词库越大</span>
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

          <div
            v-if="tagState.progress"
            class="progress"
          >
            <div
              :class="[
                'progress-msg',
                {
                  bad: tagState.progress.stage === 'error',
                  ok: tagState.progress.stage === 'done',
                },
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
          style="--d: 140ms"
        >
          <div class="card-head">
            <span class="card-icon green"><Icon name="translate" /></span>
            <div>
              <h2>AI 补全中文翻译</h2>
            </div>
          </div>
          <div class="form-field">
            <label for="settings-translate-min">最小引用数</label>
            <div class="inline-field">
              <input
                id="settings-translate-min"
                v-model="form.translateMinCount"
                class="input number-input"
                type="number"
                min="1"
              />
              <span class="help">只翻译引用数不低于该值、且还没有中文的 tag</span>
            </div>
          </div>
          <div class="row">
            <button
              class="btn primary"
              :disabled="running"
              title="使用已保存的 AI 服务，会消耗服务额度"
              @click="translate"
            >
              <Icon
                name="sparkle"
                :size="16"
              />开始 AI 翻译
            </button>
            <button
              class="btn ghost small"
              @click="selectService('ai')"
            >
              配置 AI 服务
            </button>
          </div>
        </div>
      </section>
      <section
        v-show="category === 'services'"
        id="settings-panel-services"
        role="tabpanel"
        aria-labelledby="settings-tab-services"
        class="settings-services"
      >
        <section
          v-show="service === 'nai'"
          id="settings-panel-nai"
          role="tabpanel"
          aria-labelledby="settings-service-nai"
          tabindex="0"
          class="settings-panel"
        >
          <div
            id="nai"
            class="card"
            style="--d: 105ms"
          >
            <div class="card-head">
              <span class="card-icon"><Icon name="image" /></span>
              <div>
                <h2>NovelAI</h2>
              </div>
            </div>
            <div class="form-grid">
              <div class="form-field full">
                <label
                  >Persistent API Token<HelpTip
                    label="Persistent API Token"
                    text="在 NovelAI 网页「设置 → Account → Get Persistent API Token」获取。只保存在本机，只用于请求头"
                /></label>
                <input
                  v-model="form.naiToken"
                  class="input"
                  type="password"
                  :disabled="naiBusy"
                  aria-label="NovelAI Persistent API Token"
                  data-mcp-private
                  placeholder="pst-..."
                  autocomplete="off"
                />
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
              </div>
            </div>
            <div class="row">
              <button
                class="btn primary"
                :disabled="naiBusy"
                @click="saveNai()"
              >
                <Icon
                  name="check"
                  :size="16"
                />保存
              </button>
              <button
                class="btn"
                :disabled="naiBusy || !form.naiToken.trim()"
                @click="saveNai(true)"
              >
                <Icon
                  name="key"
                  :size="15"
                />保存并测试连接
              </button>
              <button
                class="btn ghost"
                :disabled="naiBusy || (!form.naiToken && !settingsState.settings?.naiToken)"
                @click="saveNai(false, true)"
              >
                清除 Token
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
            <p
              v-if="naiError"
              class="error-box"
              role="alert"
            >
              {{ naiError }}
            </p>
          </div>
        </section>
        <section
          v-show="service === 'ai'"
          id="settings-panel-ai"
          role="tabpanel"
          aria-labelledby="settings-service-ai"
          tabindex="0"
          class="settings-panel"
        >
          <div
            class="card"
            style="--d: 70ms"
          >
            <div class="card-head">
              <span class="card-icon blue"><Icon name="key" /></span>
              <div>
                <h2>模型接口</h2>
              </div>
            </div>
            <div class="form-grid">
              <div class="form-field full">
                <label for="ai-preset">接口预设</label>
                <ThemeSelect
                  id="ai-preset"
                  :model-value="form.aiPreset"
                  :options="presetOptions"
                  aria-label="接口预设"
                  @update:model-value="choosePreset"
                />
              </div>
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
                  aria-label="AI Base URL"
                  class="input"
                  @input="form.aiPreset = 'custom'"
                />
              </div>
              <div class="form-field">
                <label>模型</label>
                <div class="model-picker">
                  <input
                    v-model="form.model"
                    aria-label="AI 模型名称"
                    placeholder="选择或输入模型 ID"
                    class="input"
                  />
                  <ThemeSelect
                    class="model-suggestions"
                    model-value=""
                    :options="modelOptions"
                    :disabled="modelOptions.length < 2"
                    aria-label="常用模型"
                    @update:model-value="chooseModel"
                  />
                </div>
              </div>
              <div
                v-if="deepSeekProvider"
                class="form-field full"
              >
                <label>DeepSeek 思考模式</label>
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
              </div>
            </div>
            <div class="row">
              <button
                class="btn primary"
                :disabled="!form.baseUrl.trim() || !form.model.trim()"
                @click="saveCategory('ai').catch(reportError)"
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
          <StatisticsSettings
            v-if="category === 'services' && service === 'ai'"
            compact
            :active="shellState.tab === 'settings'"
            @open="selectCategory('statistics')"
          />
        </section>
        <section
          v-show="service === 'agent'"
          id="settings-panel-agent"
          role="tabpanel"
          aria-labelledby="settings-service-agent"
          tabindex="0"
          class="settings-panel"
        >
          <AgentSettings
            :allow-ai="form.mcpAllowAi"
            :allow-generate="form.mcpAllowGenerate"
            @permission="setMcp"
            @manage-skills="skillsState.skillPanel = true"
          />
        </section>
        <section
          v-show="service === 'skills'"
          id="settings-panel-skills"
          role="tabpanel"
          aria-labelledby="settings-service-skills"
          tabindex="0"
          class="settings-panel"
        >
          <SkillManager ref="skillManager" />
        </section>
      </section>
      <section
        v-if="category === 'statistics'"
        id="settings-panel-statistics"
        role="tabpanel"
        aria-labelledby="settings-tab-statistics"
        class="settings-panel"
        tabindex="0"
      >
        <StatisticsSettings :active="shellState.tab === 'settings'" />
      </section>
      <section
        v-show="category === 'other'"
        id="settings-panel-other"
        role="tabpanel"
        aria-labelledby="settings-tab-other"
        tabindex="0"
        class="settings-panel"
      >
        <StorageSettings id="storage" />
        <UpdateSettings id="updates" />
      </section>
    </div>
  </div>
</template>

<style scoped>
/*
 * 两栏：左侧设置导航（AI 服务的子项在其下方展开），右侧内容。
 * 导航与内容各自滚动，内容限宽居左，宽屏下不会拉成长行。
 */
.settings-categorized {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.settings-navigation {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 20px 12px;
  border-right: 1px solid var(--line);
}

/* 两组 tablist 保留各自的语义，导航里按视觉顺序把子项排在「AI 服务」下面 */
.settings-tabs {
  display: contents;
}

#settings-tab-tags {
  order: 0;
}

#settings-tab-services {
  order: 1;
}

#settings-tab-statistics {
  order: 3;
}

#settings-tab-other {
  order: 4;
}

.settings-tabs button {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--text2);
  font-size: 13px;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.settings-tabs button .icon {
  color: var(--muted);
  transition: color var(--dur-fast) var(--ease-out);
}

.settings-tabs button:hover {
  color: var(--text);
  background: var(--hover);
}

.settings-tabs button:active {
  transform: scale(var(--press));
}

.settings-tabs button[aria-selected='true'] {
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-weight: 600;
}

.settings-tabs button[aria-selected='true'] .icon {
  color: var(--pink);
}

.settings-tabs .settings-dirty-dot {
  margin-left: auto;
}

/* 子导航：高度从 0 展开，配合淡入，不跳 */
.settings-services-nav {
  order: 2;
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--dur-slow) var(--ease-out),
    opacity var(--dur-base) var(--ease-out);
}

.settings-services-nav.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.settings-services-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  overflow: hidden;
  margin-left: 19px;
  padding: 2px 0 6px 10px;
  border-left: 1px solid var(--line2);
  transition: padding var(--dur-slow) var(--ease-out);
}

.settings-services-nav:not(.open) .settings-services-list {
  padding-block: 0;
}

.settings-services-nav button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 12.5px;
  text-align: left;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.settings-services-nav button:hover {
  color: var(--text);
  background: var(--hover);
}

.settings-services-nav button[aria-selected='true'] {
  color: var(--text);
  font-weight: 600;
}

/* 当前子项：左侧竖线上的粉色指示 */
.settings-services-nav button[aria-selected='true']::before {
  content: '';
  position: absolute;
  left: -11px;
  top: 7px;
  bottom: 7px;
  width: 2px;
  border-radius: 2px;
  background: var(--pink);
}

.settings-services-nav .settings-dirty-dot {
  margin-left: auto;
}

.settings-dirty-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--pink-deep);
}

.settings-content {
  min-height: 0;
  overflow: auto;
  padding: 24px 36px 48px;
}

/* 面板用 v-show 切换，重新显示时播放一次轻淡入 */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 780px;
  animation: view-in var(--dur-base) var(--ease-out);
}

.settings-panel > :deep(.card) {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  animation: none;
}

.settings-panel > :deep(.card + .card) {
  margin-top: 12px;
  padding-top: 28px;
  border-top: 1px solid var(--line);
}

.settings-panel :deep(.card-head > .card-icon) {
  display: none;
}

.settings-panel :deep(.sm-group) {
  gap: 0;
}

.settings-panel :deep(.sm-group-title) {
  padding: 12px 0 6px;
}

.settings-panel :deep(.sm-item) {
  padding: 14px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
}

.inline-field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.form-field .inline-field .number-input {
  align-self: auto;
  width: 120px;
}

.inline-field .help {
  margin: 0;
}

.data-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin-top: -5px;
  color: var(--muted);
  font-size: 12px;
}

@media (width <= 1100px) {
  .settings-categorized {
    grid-template-columns: 172px minmax(0, 1fr);
  }

  .settings-content {
    padding: 20px 24px 40px;
  }
}

.model-picker {
  display: flex;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.model-picker input {
  flex: 1;
  min-width: 0;
}

.model-picker :deep(.model-suggestions) {
  width: 120px;
  flex-shrink: 0;
}
</style>
