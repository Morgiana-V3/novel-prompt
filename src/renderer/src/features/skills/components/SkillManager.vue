<script setup lang="ts">
import { skillsState } from '../state'
import { shellState } from '../../../shared/state/shell'
import { computed, onMounted, ref, watch } from 'vue'
import type { SkillConfigItem, SkillDoc } from '@shared/skills/types'
import { cleanErr } from '../../../shared/lib/format'
import { loadSkills } from '../state'
import { toast } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'
import SkillEditor from './SkillEditor.vue'

/** 设置页：Skill 的导入、新建、编辑、复制、删除。启用与优先级在侧栏浮层里设置 */

const SCOPE: Record<string, string> = {
  optimize: 'AI 优化',
  preview: '画面推测',
  inpaint: '局部重绘',
  all: '全部功能',
}
const MODEL: Record<string, string> = { all: '通用', 'v4.5': 'V4.5', v5: 'V5' }

const list = computed(() => skillsState.skills)
const builtins = computed(() => list.value.filter((skill) => skill.builtin))
const mine = computed(() => list.value.filter((skill) => !skill.builtin))

/** 编辑器：undefined = 关闭；null doc = 新建 */
const editing = ref<{ doc: SkillDoc | null; readonly: boolean; title?: string } | undefined>()
const confirmDel = ref('')
function prepareUpdate(): void {
  if (editing.value && !editing.value.readonly) {
    throw new Error('请先保存或关闭 Skill 编辑器，再重启更新')
  }
}
defineExpose({ prepareUpdate })

onMounted(loadSkills)
watch(
  () => shellState.tab,
  (tab) => tab === 'settings' && loadSkills(),
)

const fmtChars = (numericValue: number) =>
  numericValue >= 10000
    ? `${(numericValue / 10000).toFixed(1)} 万字`
    : `${numericValue.toLocaleString()} 字`
const priorityOf = (skill: SkillConfigItem) =>
  list.value.filter((skill2) => skill2.enabled).findIndex((skill2) => skill2.id === skill.id) + 1

async function open(skill: SkillConfigItem) {
  const doc = await window.api.skillsGet(skill.id)
  if (!doc) {
    return (toast('找不到这份 Skill，可能已被删除'), loadSkills())
  }
  editing.value = { doc, readonly: skill.builtin }
}

async function viewCore() {
  const content = await window.api.skillsCore()
  editing.value = {
    doc: {
      id: 'core',
      name: 'Skill 使用总则',
      description: '固定生效：规定 AI 如何使用启用的 Skill，以及冲突时怎么按优先级取舍',
      scope: 'all',
      model: 'all',
      builtin: true,
      chars: content.length,
      updatedAt: 0,
      content,
    },
    readonly: true,
    title: 'Skill 使用总则（固定生效，不可关闭）',
  }
}

async function duplicate(id: string) {
  try {
    const doc = await window.api.skillsDuplicate(id)
    await loadSkills()
    editing.value = { doc, readonly: false, title: '编辑副本' }
    toast('已复制。副本默认不启用，改好后在侧栏「Skill」里启用')
  } catch (error) {
    toast(cleanErr(error))
  }
}

async function importMd() {
  try {
    const importResult = await window.api.skillsImport()
    await loadSkills()
    if (importResult.imported.length) {
      toast(`已导入 ${importResult.imported.join('、')}，已启用并放在最高优先级`)
    }
    if (importResult.errors.length) {
      alert(`以下文件导入失败：\n${importResult.errors.join('\n')}`)
    }
  } catch (error) {
    toast(cleanErr(error))
  }
}

async function remove(skill: SkillConfigItem) {
  if (confirmDel.value !== skill.id) {
    confirmDel.value = skill.id
    setTimeout(() => confirmDel.value === skill.id && (confirmDel.value = ''), 3000)
    return
  }
  confirmDel.value = ''
  try {
    await window.api.skillsDelete(skill.id)
    await loadSkills()
    toast(`已删除「${skill.name}」`)
  } catch (error) {
    toast(cleanErr(error))
  }
}

const reveal = (id?: string) => window.api.skillsReveal(id)
const openPicker = () => (skillsState.skillPanel = true)
</script>

<template>
  <div
    id="skill-manager"
    class="card"
    style="--d: 90ms"
  >
    <div class="card-head">
      <span class="card-icon"><Icon name="layers" /></span>
      <div>
        <h2>Skill 管理</h2>
        <div class="card-desc">
          Skill 决定内置 AI（AI 优化、画面推测）和
          agent（prompt_guide）怎么写、怎么读提示词。这里负责导入、编辑和删除；启用哪些、谁优先，在侧栏「Skill」里设置。
        </div>
      </div>
    </div>

    <div class="row">
      <button
        class="btn primary small"
        @click="importMd"
      >
        <Icon
          name="upload"
          :size="14"
        />导入 .md
      </button>
      <button
        class="btn small"
        @click="editing = { doc: null, readonly: false }"
      >
        <Icon
          name="plus"
          :size="14"
        />新建
      </button>
      <button
        class="btn ghost small"
        @click="openPicker"
      >
        <Icon
          name="sliders"
          :size="14"
        />启用与优先级
      </button>
      <button
        class="btn ghost small ml-auto"
        @click="viewCore"
      >
        <Icon
          name="book"
          :size="14"
        />查看使用总则
      </button>
      <button
        class="btn ghost small"
        @click="reveal()"
      >
        <Icon
          name="folder"
          :size="14"
        />打开文件夹
      </button>
    </div>

    <div class="sm-group">
      <div class="sm-group-title">内置（只读）</div>
      <div
        v-for="s in builtins"
        :key="s.id"
        class="sm-item"
      >
        <div class="sm-main">
          <div class="sm-name">
            <b>{{ s.name }}</b>
            <span :class="['pill', s.enabled ? 'ok' : '']">{{
              s.enabled ? `启用 · 第 ${priorityOf(s)} 位` : '未启用'
            }}</span>
            <span class="pill">{{ SCOPE[s.scope] }}</span>
            <span class="muted small">{{ fmtChars(s.chars) }}</span>
          </div>
          <div class="sm-desc">{{ s.description }}</div>
        </div>
        <div class="sm-actions">
          <button
            class="btn ghost small"
            @click="open(s)"
          >
            <Icon
              name="eye"
              :size="14"
            />查看
          </button>
          <button
            class="btn ghost small"
            @click="duplicate(s.id)"
          >
            <Icon
              name="copy"
              :size="14"
            />复制为我的 Skill
          </button>
        </div>
      </div>
    </div>

    <div class="sm-group">
      <div class="sm-group-title">我的 Skill</div>
      <div
        v-if="!mine.length"
        class="sm-empty muted"
      >
        还没有自己的 Skill。可以导入 .md 文件、新建一份，或把内置 Skill 复制一份再改。
      </div>
      <div
        v-for="s in mine"
        :key="s.id"
        class="sm-item"
      >
        <div class="sm-main">
          <div class="sm-name">
            <b>{{ s.name }}</b>
            <span :class="['pill', s.enabled ? 'ok' : '']">{{
              s.enabled ? `启用 · 第 ${priorityOf(s)} 位` : '未启用'
            }}</span>
            <span class="pill">{{ SCOPE[s.scope] }}</span>
            <span
              v-if="s.model !== 'all'"
              class="pill"
              >{{ MODEL[s.model] }}</span
            >
            <span class="muted small">{{ fmtChars(s.chars) }}</span>
          </div>
          <div class="sm-desc">{{ s.description || '（没有说明）' }}</div>
        </div>
        <div class="sm-actions">
          <button
            class="btn ghost small"
            @click="open(s)"
          >
            <Icon
              name="edit"
              :size="14"
            />编辑
          </button>
          <button
            class="icon-btn sm"
            title="复制"
            @click="duplicate(s.id)"
          >
            <Icon
              name="copy"
              :size="15"
            />
          </button>
          <button
            class="icon-btn sm"
            title="在文件夹中显示"
            @click="reveal(s.id)"
          >
            <Icon
              name="folder"
              :size="15"
            />
          </button>
          <button
            :class="['btn small', confirmDel === s.id ? 'danger' : 'ghost']"
            :title="confirmDel === s.id ? '再点一次确认删除' : '删除'"
            @click="remove(s)"
          >
            <Icon
              name="trash"
              :size="14"
            />{{ confirmDel === s.id ? '确认删除' : '' }}
          </button>
        </div>
      </div>
    </div>

    <div class="help">
      只支持 .md 文件。文件开头可以用 frontmatter 写 name / description /
      scope（optimize、preview、inpaint、all）/
      model（all、v4.5、v5），导入时会自动读取。也可以直接把 .md 放进 Skill
      文件夹，放进去的默认不启用。
    </div>

    <SkillEditor
      v-if="editing"
      :doc="editing.doc"
      :readonly="editing.readonly"
      :title="editing.title"
      @close="editing = undefined"
      @duplicate="(id) => ((editing = undefined), duplicate(id))"
    />
  </div>
</template>

<style scoped>
.sm-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sm-group-title {
  font-size: 12px;
  color: var(--muted);
  padding: 2px 2px 0;
}

.sm-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  transition: background 0.15s;
}

.sm-item:hover {
  background: var(--panel);
}

.sm-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sm-name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sm-name b {
  font-size: 13.5px;
}

.sm-desc {
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.sm-empty {
  font-size: 12.5px;
  padding: 12px;
  border: 1px dashed var(--line2);
  border-radius: 12px;
  text-align: center;
}

.help {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.6;
}

.btn.danger {
  background: var(--bad);
  color: #fff;
  border-color: var(--bad);
}
</style>
