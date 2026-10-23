<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { SkillDoc, SkillModel, SkillScope } from '@shared/types'
import { cleanErr, loadSkills, toast } from '../store'
import Icon from './Icon.vue'

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
  name: props.doc?.name ?? '',
  description: props.doc?.description ?? '',
  scope: (props.doc?.scope ?? 'optimize') as SkillScope,
  model: (props.doc?.model ?? 'all') as SkillModel,
  content: props.doc?.content ?? TEMPLATE
})
const initial = JSON.stringify(form)
const dirty = computed(() => !props.readonly && JSON.stringify(form) !== initial)
const saving = ref(false)
const error = ref('')

const scopes: { v: SkillScope; label: string }[] = [
  { v: 'optimize', label: 'AI 优化' },
  { v: 'preview', label: '画面推测' },
  { v: 'all', label: '全部' }
]
const models: { v: SkillModel; label: string }[] = [
  { v: 'all', label: '通用' },
  { v: 'v4.5', label: 'V4.5' },
  { v: 'v5', label: 'V5' }
]

async function save() {
  if (!form.name.trim()) return (error.value = '请填写名称')
  if (!form.content.trim()) return (error.value = '正文不能为空')
  saving.value = true
  error.value = ''
  try {
    const input = { ...form }
    const doc = props.doc ? await window.api.skillsUpdate(props.doc.id, input) : await window.api.skillsCreate(input)
    await loadSkills()
    toast(props.doc ? '已保存，下一次调用 AI 时生效' : '已创建并启用（最高优先级）')
    emit('saved', doc)
    emit('close')
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    saving.value = false
  }
}

function close() {
  if (dirty.value && !confirm('有未保存的修改，确定关闭吗？')) return
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !props.readonly) {
    e.preventDefault()
    save()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="sk-mask" @pointerdown.self="close">
      <div class="sk-dialog">
        <div class="sk-head">
          <span class="group-badge pink"><Icon :name="readonly ? 'eye' : 'edit'" :size="14" /></span>
          <h3>{{ title ?? (readonly ? '查看 Skill' : doc ? '编辑 Skill' : '新建 Skill') }}</h3>
          <span v-if="readonly" class="pill">只读</span>
          <span class="muted small ml-auto">{{ form.content.length.toLocaleString() }} 字</span>
          <button class="icon-btn sm" title="关闭（Esc）" @click="close"><Icon name="x" :size="15" /></button>
        </div>

        <div class="sk-body">
          <div v-if="doc?.id !== 'core'" class="sk-meta">
            <div class="form-field">
              <label>名称</label>
              <input class="input" v-model="form.name" :readonly="readonly" placeholder="如：我的厚涂风格" />
            </div>
            <div class="form-field grow2">
              <label>说明</label>
              <input class="input" v-model="form.description" :readonly="readonly" placeholder="一句话说明这份 Skill 管什么，会出现在给 AI 的清单里" />
            </div>
            <div class="form-field">
              <label>作用于</label>
              <div class="seg">
                <button v-for="s in scopes" :key="s.v" :class="{ on: form.scope === s.v }" :disabled="readonly" @click="form.scope = s.v">{{ s.label }}</button>
              </div>
            </div>
            <div class="form-field">
              <label>适用模型</label>
              <div class="seg">
                <button v-for="m in models" :key="m.v" :class="{ on: form.model === m.v }" :disabled="readonly" @click="form.model = m.v">{{ m.label }}</button>
              </div>
            </div>
          </div>
          <textarea class="sk-text" v-model="form.content" :readonly="readonly" spellcheck="false"></textarea>
          <div v-if="!readonly" class="help">
            正文用 Markdown 书写，就是给 AI 的规则。「AI 优化」也作用于描述转提示词和 agent 读取的 prompt_guide。只在某个版本生效的规则，可以在条目里标注【V4.5】/【V5】，或把整份的适用模型设为对应版本。输出格式、Text: 等语法由软件固定，不需要写。
          </div>
          <div v-if="error" class="error-box"><Icon name="warn" :size="15" />{{ error }}</div>
        </div>

        <div class="sk-foot">
          <template v-if="readonly">
            <button v-if="doc && doc.id !== 'core'" class="btn small" @click="emit('duplicate', doc.id)"><Icon name="copy" :size="14" />复制为我的 Skill</button>
            <button class="btn primary small" @click="emit('close')">关闭</button>
          </template>
          <template v-else>
            <span class="muted small">Ctrl+S 保存</span>
            <button class="btn ghost small" @click="close">取消</button>
            <button class="btn primary small" :disabled="saving" @click="save"><Icon name="check" :size="14" />{{ doc ? '保存' : '创建' }}</button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sk-mask {
  position: fixed; inset: 0; z-index: 85; display: grid; place-items: center; padding: 28px;
  background: rgba(16, 16, 20, 0.42); backdrop-filter: blur(3px); animation: fade-in 0.18s;
}
@keyframes fade-in { from { opacity: 0; } }
.sk-dialog {
  width: min(980px, 100%); height: min(860px, 100%); display: flex; flex-direction: column; background: #fff;
  border: 1px solid var(--line2); border-radius: 18px; box-shadow: 0 24px 60px rgba(20, 20, 30, 0.22); overflow: hidden;
  animation: pop 0.28s var(--bounce);
}
.sk-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
.sk-head h3 { margin: 0; font-size: 14px; }
.sk-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
.sk-meta { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; }
.sk-meta .form-field { display: flex; flex-direction: column; gap: 5px; min-width: 180px; }
.sk-meta .form-field.grow2 { flex: 1; min-width: 260px; }
.sk-meta label { font-size: 12px; color: var(--text2); }
.sk-text {
  flex: 1; min-height: 200px; resize: none; width: 100%; padding: 12px 14px; border: 1px solid var(--line2); border-radius: 12px;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.65; color: var(--text); background: #fff; outline: none; user-select: text;
}
.sk-text:focus { border-color: var(--pink-line); box-shadow: 0 0 0 3px var(--pink-soft); }
.sk-text[readonly] { background: var(--panel); }
.help { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.sk-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--line); }
.sk-foot .muted { margin-right: auto; }
</style>
