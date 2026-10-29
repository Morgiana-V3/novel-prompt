<script setup lang="ts">
import HelpTip from '../../../shared/ui/HelpTip.vue'
import { skillsState } from '../state'
import { shellState } from '../../../shared/state/shell'
import { computed, onMounted, ref, watch } from 'vue'
import type { SkillConfigItem, SkillDoc, SkillImportPreview, SkillMeta } from '@shared/skills/types'
import { cleanErr } from '../../../shared/lib/format'
import { loadSkills } from '../state'
import { toast } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'
import { missingSkillLinks } from '@shared/skills/references'
import SkillDocument from './SkillDocument.vue'
import SkillEditor from './SkillEditor.vue'
import SkillImportButton from './SkillImportButton.vue'

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
const importing = ref<SkillImportPreview | null>(null)
const importBusy = ref(false)
const importError = ref('')
function prepareUpdate(): void {
  if (importing.value) {
    throw new Error('请先完成或取消 Skill 导入')
  }
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

async function open(skill: SkillMeta, readonly = skill.builtin) {
  const doc = await window.api.skillsGet(skill.id)
  if (!doc) {
    return (toast('找不到这份 Skill，可能已被删除'), loadSkills())
  }
  editing.value = {
    doc,
    readonly,
  }
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
  importBusy.value = true
  importError.value = ''
  try {
    const importResult = await window.api.skillsImport()
    await loadSkills()
    if (importResult.imported.length) {
      toast(`已导入 ${importResult.imported.join('、')}，已启用并放在最高优先级`)
    }
    if (importResult.errors.length) {
      importError.value = `以下文件导入失败：\n${importResult.errors.join('\n')}`
    }
  } catch (error) {
    toast(cleanErr(error))
  } finally {
    importBusy.value = false
  }
}

async function importDirectory() {
  importBusy.value = true
  try {
    importError.value = ''
    importing.value = await window.api.skillsImportDirectory()
    if (importing.value) {
      importing.value.warnings.push(
        ...missingSkillLinks(importing.value.input.content, importing.value.input.resources ?? []),
      )
    }
  } catch (error) {
    toast(cleanErr(error))
  } finally {
    importBusy.value = false
  }
}

async function confirmImport() {
  if (!importing.value || importBusy.value) {
    return
  }
  importBusy.value = true
  try {
    await window.api.skillsCreate(JSON.parse(JSON.stringify(importing.value.input)))
    importing.value = null
    await loadSkills()
    toast('已导入独立副本并启用；原文件夹不会被修改')
  } catch (error) {
    importError.value = cleanErr(error)
  } finally {
    importBusy.value = false
  }
}

async function exportDirectory(id: string) {
  try {
    const path = await window.api.skillsExport(id)
    if (path) {
      toast(`已导出到 ${path}`)
    }
  } catch (error) {
    toast(cleanErr(error))
  }
}

async function remove(skill: SkillMeta) {
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
        <h2>
          Skill 管理<HelpTip
            label="Skill 管理"
            text="Skill 决定内置 AI（AI 优化、画面推测）和 agent（prompt_guide）怎么写、怎么读提示词。这里负责导入、编辑和删除；启用哪些、谁优先，在侧栏「Skill」里设置。"
          />
        </h2>
      </div>
    </div>

    <div class="row">
      <SkillImportButton
        :disabled="importBusy"
        @select="(kind) => (kind === 'file' ? importMd() : importDirectory())"
      />
      <HelpTip
        label="导入 Skill"
        text="可导入单个 .md，或根目录含 SKILL.md 的文件夹。目录包支持 Markdown 参考资料和图片，脚本不执行。保存独立副本，同名导入不覆盖原 Skill；导入后可调整作用范围和模型。"
      />
      <button
        class="btn ghost small"
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

    <p
      v-if="importError && !importing"
      class="error-box"
      role="alert"
    >
      {{ importError }}
    </p>

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
            <span class="muted small"
              >入口 {{ fmtChars(s.chars)
              }}<template v-if="s.format === 'directory'">
                · 目录包 · {{ s.resourceCount }} 个参考文件</template
              ></span
            >
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
      <div class="sm-group-title">用户 Skill</div>
      <div
        v-if="!mine.length"
        class="sm-empty muted"
      >
        还没有自己的 Skill。可以导入单个 .md 或包含 SKILL.md 的文件夹，也可以新建或复制内置 Skill。
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
            <span class="muted small"
              >入口 {{ fmtChars(s.chars)
              }}<template v-if="s.format === 'directory'">
                · 目录包 · {{ s.resourceCount }} 个参考文件</template
              ></span
            >
          </div>
          <div class="sm-desc">{{ s.description || '（没有说明）' }}</div>
        </div>
        <div class="sm-actions">
          <button
            class="btn ghost small"
            @click="open(s, true)"
          >
            查看
          </button>
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
            class="btn ghost small"
            @click="exportDirectory(s.id)"
          >
            导出
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

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="importing"
          class="skill-import-mask"
        >
          <section
            class="skill-import-dialog modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="导入 Skill 预览"
          >
            <h3>导入 Skill 文件夹</h3>
            <p>
              <b>{{ importing.input.name }}</b> · 入口 SKILL.md ·
              {{ importing.input.resources?.length ?? 0 }} 个参考文件
            </p>
            <p class="muted small">
              {{ importing.input.description || '没有说明，可在导入后编辑。' }} · 导入后默认启用
            </p>
            <SkillDocument
              :model-value="importing.input.content"
              :resources="importing.input.resources ?? []"
              readonly
            />
            <details
              v-if="importing.warnings.length"
              open
              class="skill-import-warnings"
            >
              <summary>{{ importing.warnings.length }} 项导入提示</summary>
              <p
                v-for="warning in importing.warnings"
                :key="warning"
              >
                {{ warning }}
              </p>
            </details>
            <p
              v-if="importError"
              class="error-box"
            >
              {{ importError }}
            </p>
            <div class="row">
              <span class="muted small">保存独立副本，不修改来源文件夹</span>
              <button
                class="btn small ml-auto"
                :disabled="importBusy"
                @click="importing = null"
              >
                取消
              </button>
              <button
                class="btn primary small"
                :disabled="importBusy"
                @click="confirmImport"
              >
                {{ importBusy ? '正在导入…' : '确认导入' }}
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

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
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
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

.skill-import-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 36px;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}

.skill-import-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(900px, 100%);
  height: min(800px, 90vh);
  padding: 24px;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 18px;
  box-shadow: var(--shadow-modal);
}

.skill-import-warnings {
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>
