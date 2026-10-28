<script setup lang="ts">
import { reportError } from '../../../shared/lib/notifications'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { SkillDoc, SkillModel, SkillScope, SkillResource } from '@shared/skills/types'
import { cleanErr } from '../../../shared/lib/format'
import { loadSkills } from '../state'
import { toast } from '../../../shared/lib/notifications'
import SkillDocument from './SkillDocument.vue'
import { missingSkillLinks } from '@shared/skills/references'
import Icon from '../../../shared/ui/Icon.vue'
import ConfirmDialog from '../../../shared/ui/ConfirmDialog.vue'

/**
 * Skill 编辑 / 查看弹窗。
 * - doc 为 null：新建
 * - readonly：查看内置 Skill 或使用总则
 */
const props = defineProps<{ doc: SkillDoc | null; readonly?: boolean; title?: string }>()
const emit = defineEmits<{ close: []; saved: [doc: SkillDoc]; duplicate: [id: string] }>()

const TEMPLATE = `# 我的风格

> 用一两句话说明这份 Skill 管什么。多份 Skill 冲突时，按侧栏「Skill」里的优先级取舍。

## 规则
- 例：画师固定使用 artist:xxx，权重 0.8
- 例：负面提示词不要放 bad anatomy
- 【V4.5】只在 V4.5 下生效的规则写在这样标注的条目里
- 【V5】只在 V5 下生效的规则写在这样标注的条目里
`

const form = reactive({
  format: props.doc?.format,
  resources: JSON.parse(JSON.stringify(props.doc?.resources ?? [])) as SkillResource[],
  name: props.doc?.name ?? '',
  description: props.doc?.description ?? '',
  scope: (props.doc?.scope ?? 'optimize') as SkillScope,
  model: (props.doc?.model ?? 'all') as SkillModel,
  content: props.doc?.content ?? TEMPLATE,
})
const linkWarnings = computed(() => missingSkillLinks(form.content, form.resources))
const opened = ref(true)
const initial = JSON.stringify(form)
const dirty = computed(() => !props.readonly && JSON.stringify(form) !== initial)
const saving = ref(false)
const error = ref('')
const confirmation = ref<'discard' | 'links' | null>(null)

const scopes: { v: SkillScope; label: string }[] = [
  { v: 'optimize', label: 'AI 优化' },
  { v: 'preview', label: '画面推测' },
  { v: 'inpaint', label: '局部重绘' },
  { v: 'all', label: '全部' },
]
const models: { v: SkillModel; label: string }[] = [
  { v: 'all', label: '通用' },
  { v: 'v4.5', label: 'V4.5' },
  { v: 'v5', label: 'V5' },
]

async function save(allowBrokenLinks = false) {
  if (!opened.value || saving.value) {
    return
  }
  if (!form.name.trim()) {
    return (error.value = '请填写名称')
  }
  if (!form.content.trim()) {
    return (error.value = '正文不能为空')
  }
  if (linkWarnings.value.length && !allowBrokenLinks) {
    confirmation.value = 'links'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const input = JSON.parse(JSON.stringify(form))
    const doc = props.doc
      ? await window.api.skillsUpdate(props.doc.id, input)
      : await window.api.skillsCreate(input)
    await loadSkills()
    toast(props.doc ? '已保存，下一次调用 AI 时生效' : '已创建并启用（最高优先级）')
    emit('saved', doc)
    opened.value = false
  } catch (error2) {
    error.value = cleanErr(error2)
  } finally {
    saving.value = false
  }
}

function close() {
  if (!opened.value || saving.value) {
    return
  }
  if (dirty.value) {
    confirmation.value = 'discard'
    return
  }
  opened.value = false
}

function confirmAction() {
  const action = confirmation.value
  confirmation.value = null
  if (action === 'discard') {
    opened.value = false
  } else if (action === 'links') {
    save(true).catch(reportError)
  }
}

function saveAndClose() {
  confirmation.value = null
  save().catch(reportError)
}

function onKey(event2: KeyboardEvent) {
  if (!opened.value || confirmation.value || event2.defaultPrevented) {
    return
  }
  if (event2.key === 'Escape') {
    close()
  } else if (
    (event2.ctrlKey || event2.metaKey) &&
    event2.key.toLowerCase() === 's' &&
    !props.readonly
  ) {
    event2.preventDefault()
    save().catch(reportError)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition
      name="modal"
      appear
      @after-leave="emit('close')"
    >
      <div
        v-if="opened"
        class="sk-mask"
        @pointerdown.self="close"
      >
        <div class="sk-dialog modal-panel">
          <div class="sk-head">
            <span class="group-badge pink"
              ><Icon
                :name="readonly ? 'eye' : 'edit'"
                :size="14"
            /></span>
            <h3>{{ title ?? (readonly ? '查看 Skill' : doc ? '编辑 Skill' : '新建 Skill') }}</h3>
            <span
              v-if="readonly"
              class="pill"
              >只读</span
            >
            <span class="muted small ml-auto">{{ form.content.length.toLocaleString() }} 字</span>
            <button
              class="icon-btn sm"
              title="关闭（Esc）"
              @click="close"
            >
              <Icon
                name="x"
                :size="15"
              />
            </button>
          </div>

          <div class="sk-body">
            <div
              v-if="doc?.id !== 'core'"
              class="sk-meta"
            >
              <div class="form-field">
                <label>名称</label>
                <input
                  v-model="form.name"
                  class="input"
                  :readonly="readonly"
                  placeholder="如：我的厚涂风格"
                />
              </div>
              <div class="form-field grow2">
                <label>说明</label>
                <input
                  v-model="form.description"
                  class="input"
                  :readonly="readonly"
                  placeholder="一句话说明这份 Skill 管什么，会出现在给 AI 的清单里"
                />
              </div>
              <div class="form-field">
                <label>作用于</label>
                <div class="seg">
                  <button
                    v-for="s in scopes"
                    :key="s.v"
                    :class="{ on: form.scope === s.v }"
                    :disabled="readonly"
                    @click="form.scope = s.v"
                  >
                    {{ s.label }}
                  </button>
                </div>
              </div>
              <div class="form-field">
                <label>适用模型</label>
                <div class="seg">
                  <button
                    v-for="m in models"
                    :key="m.v"
                    :class="{ on: form.model === m.v }"
                    :disabled="readonly"
                    @click="form.model = m.v"
                  >
                    {{ m.label }}
                  </button>
                </div>
              </div>
            </div>
            <SkillDocument
              v-model="form.content"
              v-model:resources="form.resources"
              :readonly="readonly"
            />
            <div
              v-if="!readonly"
              class="help"
            >
              正文用 Markdown 书写，就是给 AI 的规则。「AI 优化」也作用于描述转提示词和 agent 读取的
              prompt_guide。只在某个版本生效的规则，可以在条目里标注【V4.5】/【V5】，或把整份的适用模型设为对应版本。输出格式、Text:
              等语法由软件固定，不需要写。
            </div>
            <details
              v-if="linkWarnings.length"
              class="help"
            >
              <summary>发现 {{ linkWarnings.length }} 个失效引用，请在保存前检查</summary>
              <p
                v-for="warning in linkWarnings"
                :key="warning"
              >
                {{ warning }}
              </p>
            </details>
            <div
              v-if="error"
              class="error-box"
            >
              <Icon
                name="warn"
                :size="15"
              />{{ error }}
            </div>
          </div>

          <div class="sk-foot">
            <template v-if="readonly">
              <button
                v-if="doc && doc.id !== 'core'"
                class="btn small"
                @click="emit('duplicate', doc.id)"
              >
                <Icon
                  name="copy"
                  :size="14"
                />{{ doc?.source === 'template' ? '复制并定制' : '复制为我的 Skill' }}
              </button>
              <button
                class="btn primary small"
                @click="close"
              >
                关闭
              </button>
            </template>
            <template v-else>
              <span class="muted small">Ctrl+S 保存</span>
              <button
                class="btn ghost small"
                @click="close"
              >
                取消
              </button>
              <button
                class="btn primary small"
                :disabled="saving"
                @click="save()"
              >
                <Icon
                  name="check"
                  :size="14"
                />{{ doc ? '保存' : '创建' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
  <ConfirmDialog
    v-if="confirmation"
    :title="confirmation === 'discard' ? '保存修改后再关闭？' : '存在失效引用'"
    :message="
      confirmation === 'discard'
        ? '这份 Skill 有未保存的修改。放弃后将无法恢复本次编辑。'
        : '以下引用无法找到，仍要保存吗？\n' + linkWarnings.join('\n')
    "
    :confirm-label="confirmation === 'discard' ? '放弃修改' : '仍然保存'"
    :cancel-label="confirmation === 'discard' ? '继续编辑' : '返回检查'"
    :alternate-label="confirmation === 'discard' ? '保存并关闭' : undefined"
    :danger="confirmation === 'discard'"
    @cancel="confirmation = null"
    @confirm="confirmAction"
    @alternate="saveAndClose"
  />
</template>

<style scoped>
.sk-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: grid;
  place-items: center;
  padding: calc(var(--titlebar-safe-height) + 28px) 28px 28px;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.sk-dialog {
  width: min(1180px, 100%);
  height: min(860px, 100%);
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--line2);
  border-radius: 18px;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.sk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.sk-head h3 {
  margin: 0;
  font-size: 14px;
}

.sk-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}

.sk-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: flex-end;
}

.sk-meta .form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 180px;
}

.sk-meta .form-field.grow2 {
  flex: 1;
  min-width: 260px;
}

.sk-meta label {
  font-size: 12px;
  color: var(--text2);
}

.help {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.6;
}

.sk-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}

.sk-foot .muted {
  margin-right: auto;
}
</style>
