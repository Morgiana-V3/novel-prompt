<script setup lang="ts">
import { reportError } from '../../../shared/lib/notifications'
import { settingsState } from '../../settings/state'
import { skillsState } from '../state'
import { shellState } from '../../../shared/state/shell'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SkillConfigItem } from '@shared/skills/types'
import { loadSkills, saveSkillConfig } from '../state'
import Icon from '../../../shared/ui/Icon.vue'

/**
 * 侧栏 Skill 入口：只负责启用 / 关闭和优先级（拖动排序）。导入、编辑、删除在设置页。
 */

const SCOPE: Record<string, string> = {
  optimize: 'AI 优化',
  preview: '画面推测',
  inpaint: '局部重绘',
  workspace: '工作台',
  all: '全部',
}
const MODEL: Record<string, string> = { 'v4.5': 'V4.5', v5: 'V5' }

const version = computed(() => settingsState.settings?.naiVersion ?? 'v4.5')
const list = computed(() => skillsState.skills)
const enabled = computed(() => list.value.filter((skill) => skill.enabled))
const fits = (skill: SkillConfigItem) => skill.model === 'all' || skill.model === version.value
const covers = (
  skill: SkillConfigItem,
  feature: 'optimize' | 'preview' | 'inpaint' | 'workspace',
) => feature === 'workspace' || skill.scope === 'all' || skill.scope === feature

/** 每个功能实际生效的 Skill（按优先级） */
const effective = (feature: 'optimize' | 'preview' | 'inpaint' | 'workspace') =>
  enabled.value.filter((skill) => covers(skill, feature) && fits(skill))
const eff = computed(() => ({
  optimize: effective('optimize'),
  preview: effective('preview'),
  inpaint: effective('inpaint'),
  workspace: effective('workspace'),
}))
const fmtChars = (numericValue: number) =>
  numericValue >= 10000
    ? `${(numericValue / 10000).toFixed(1)} 万字`
    : `${numericValue.toLocaleString()} 字`
const total = (feature: 'optimize' | 'preview' | 'inpaint' | 'workspace') =>
  eff.value[feature].reduce((a, skill) => a + skill.chars, 0)
/** 叠加后的正文很长时提醒：会明显增加每次调用的 token 消耗 */
const LONG = 40000

/* ---------- 浮层位置 ---------- */
const trigger = ref<HTMLElement>()
const pos = ref({ left: 0, bottom: 0 })
function place() {
  const bounds = trigger.value?.getBoundingClientRect()
  if (!bounds) {
    return
  }
  pos.value = {
    left: bounds.right + 12,
    bottom: Math.max(12, window.innerHeight - bounds.bottom - 8),
  }
}
watch(
  () => skillsState.skillPanel,
  async (open) => {
    if (!open) {
      return
    }
    place()
    await loadSkills()
    await nextTick()
    place()
  },
)
const close = () => (skillsState.skillPanel = false)

/* ---------- 启用与排序 ---------- */
async function toggle(skill: SkillConfigItem) {
  await saveSkillConfig(
    list.value.map((skill2) =>
      skill2.id === skill.id ? { ...skill2, enabled: !skill2.enabled } : skill2,
    ),
  )
}
async function move(i: number, fallback: number) {
  const j = i + fallback
  if (j < 0 || j >= list.value.length) {
    return
  }
  const next = [...list.value]
  ;[next[i], next[j]] = [next[j], next[i]]
  await saveSkillConfig(next)
}

const dragId = ref<string | null>(null)
const draft = ref<SkillConfigItem[] | null>(null)
const shown = computed(() => draft.value ?? list.value)
function onDragStart(event2: DragEvent, skill: SkillConfigItem) {
  dragId.value = skill.id
  draft.value = [...list.value]
  event2.dataTransfer?.setData('text/plain', skill.id)
  if (event2.dataTransfer) {
    event2.dataTransfer.effectAllowed = 'move'
  }
}
function onDragOver(event2: DragEvent, over: SkillConfigItem) {
  if (!dragId.value || !draft.value) {
    return
  }
  event2.preventDefault()
  if (over.id === dragId.value) {
    return
  }
  const skill = draft.value
  const from = skill.findIndex((skill2) => skill2.id === dragId.value)
  const to = skill.findIndex((skill2) => skill2.id === over.id)
  const [item] = skill.splice(from, 1)
  skill.splice(to, 0, item)
  draft.value = [...skill]
}
async function onDragEnd() {
  const result = draft.value
  dragId.value = null
  draft.value = null
  if (
    result &&
    result.map((skill) => skill.id).join() !== list.value.map((skill) => skill.id).join()
  ) {
    await saveSkillConfig(result)
  }
}

/** 启用项的优先级序号（只给启用的编号，便于理解"第几位"） */
const rank = (skill: SkillConfigItem) =>
  shown.value.filter((skill2) => skill2.enabled).findIndex((skill2) => skill2.id === skill.id) + 1

function manage() {
  close()
  shellState.tab = 'settings'
  settingsState.settingsAnchor = 'skill-manager'
}

function onKey(event2: KeyboardEvent) {
  if (event2.key === 'Escape' && skillsState.skillPanel) {
    close()
  }
}
onMounted(() => {
  loadSkills().catch(reportError)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div>
    <div class="side-label">Skill</div>
    <button
      ref="trigger"
      :class="['skill-trigger', { on: skillsState.skillPanel }]"
      title="选择启用的 Skill 与优先级"
      @click="skillsState.skillPanel = !skillsState.skillPanel"
    >
      <span class="st-icon"
        ><Icon
          name="layers"
          :size="15"
      /></span>
      <span class="st-text">
        <b>已启用 {{ enabled.length }} 个 Skill</b>
      </span>
      <Icon
        name="chevron"
        :size="14"
        class="st-chev"
      />
    </button>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="skillsState.skillPanel"
          class="sp-mask"
          @pointerdown.self="close"
        >
          <div
            class="sp-pop modal-panel"
            :style="{ left: pos.left + 'px', bottom: pos.bottom + 'px' }"
          >
            <div class="sp-head">
              <b title="拖动排序，越靠上优先级越高；冲突时采用优先级更高的规则">启用的 Skill</b>
              <span class="pill">{{ version === 'v5' ? 'V5' : 'V4.5' }}</span>
              <button
                class="icon-btn sm ml-auto"
                title="关闭（Esc）"
                @click="close"
              >
                <Icon
                  name="x"
                  :size="14"
                />
              </button>
            </div>

            <div class="sp-list">
              <div
                v-for="(s, index) in shown"
                :key="s.id"
                :class="[
                  'sp-item',
                  { off: !s.enabled, dim: s.enabled && !fits(s), dragging: dragId === s.id },
                ]"
                draggable="true"
                @dragstart="onDragStart($event, s)"
                @dragover="onDragOver($event, s)"
                @drop.prevent
                @dragend="onDragEnd"
              >
                <span
                  class="sp-grip"
                  title="拖动调整优先级"
                  ><Icon
                    name="grip"
                    :size="14"
                /></span>
                <span class="sp-rank">{{ s.enabled ? rank(s) : '–' }}</span>
                <div class="sp-info">
                  <div
                    class="sp-name"
                    :title="s.name"
                  >
                    {{ s.name }}
                  </div>
                  <div class="sp-tags">
                    <span
                      v-if="s.builtin"
                      class="sp-tag builtin"
                      >内置</span
                    >
                    <span class="sp-tag">{{ SCOPE[s.scope] }}</span>
                    <span
                      v-if="s.model !== 'all'"
                      class="sp-tag"
                      >{{ MODEL[s.model] }}</span
                    >
                    <span
                      v-if="s.enabled && !fits(s)"
                      class="sp-tag warn"
                      >当前模型不适用</span
                    >
                  </div>
                </div>
                <div class="sp-move">
                  <button
                    class="icon-btn xs"
                    :disabled="index === 0"
                    title="上移"
                    @click="move(index, -1)"
                  >
                    <Icon
                      name="chevron"
                      :size="12"
                      style="transform: rotate(-90deg)"
                    />
                  </button>
                  <button
                    class="icon-btn xs"
                    :disabled="index === shown.length - 1"
                    title="下移"
                    @click="move(index, 1)"
                  >
                    <Icon
                      name="chevron"
                      :size="12"
                      style="transform: rotate(90deg)"
                    />
                  </button>
                </div>
                <button
                  :class="['sp-switch', { on: s.enabled }]"
                  role="switch"
                  :aria-checked="s.enabled"
                  :title="s.enabled ? '点击关闭' : '点击启用'"
                  @click="toggle(s)"
                >
                  <span></span>
                </button>
              </div>
            </div>

            <div class="sp-summary">
              <div
                v-for="f in ['optimize', 'preview', 'inpaint', 'workspace'] as const"
                :key="f"
                class="sp-row"
              >
                <span class="sp-feature">{{
                  f === 'optimize'
                    ? 'AI 优化'
                    : f === 'preview'
                      ? '画面推测'
                      : f === 'workspace'
                        ? '工作台'
                        : '局部重绘'
                }}</span>
                <span
                  v-if="eff[f].length"
                  class="sp-chain"
                  >{{ eff[f].map((s) => s.name).join(' › ') }}</span
                >
                <span
                  v-else
                  class="sp-chain warn"
                  >没有启用的 Skill，只按通用知识工作</span
                >
                <span
                  :class="['sp-size', { warn: total(f) > LONG }]"
                  :title="total(f) > LONG ? 'Skill 较长，每次调用消耗的 token 会明显增加' : ''"
                  >{{ fmtChars(total(f)) }}</span
                >
              </div>
            </div>

            <div class="sp-foot">
              <button
                class="btn ghost small"
                @click="manage"
              >
                <Icon
                  name="sliders"
                  :size="13"
                />导入 / 编辑 Skill
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.skill-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 14px;
  text-align: left;
  background: #fff;
  border: 1px solid var(--line);
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    transform 0.25s var(--bounce);
}

.skill-trigger:hover {
  border-color: var(--line2);
  box-shadow: var(--shadow-sm);
}

.skill-trigger:active {
  transform: scale(0.98);
}

.skill-trigger.on {
  border-color: var(--pink-line);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.st-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--pink-soft);
  color: var(--pink);
  flex-shrink: 0;
}

.st-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.st-text b {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}

.st-text span {
  font-size: 11px;
  color: var(--muted);
}

.st-chev {
  color: var(--muted);
  flex-shrink: 0;
}

.sp-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.sp-pop {
  position: fixed;
  width: 360px;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--line2);
  border-radius: 16px;
  box-shadow: 0 18px 48px rgb(20 20 30 / 18%);
  overflow: hidden;
  transform-origin: left bottom;
}

.sp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px 12px 14px;
}

.sp-head b {
  font-size: 13.5px;
}

.sp-tip {
  font-size: 11.5px;
  color: var(--muted);
  padding: 0 14px 8px;
  line-height: 1.5;
}

.sp-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: #fff;
  transition:
    background 0.15s,
    opacity 0.15s,
    border-color 0.15s;
}

.sp-item:hover {
  background: var(--panel);
}

.sp-item:hover .sp-move {
  opacity: 1;
}

.sp-item.off .sp-info,
.sp-item.off .sp-rank {
  opacity: 0.5;
}

.sp-item.dim .sp-name {
  color: var(--text2);
}

.sp-item.dragging {
  opacity: 0.45;
  border-style: dashed;
  border-color: var(--pink-line);
}

.sp-grip {
  color: var(--muted);
  cursor: grab;
  display: grid;
  place-items: center;
}

.sp-rank {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  background: var(--hover);
  color: var(--text2);
}

.sp-item:not(.off) .sp-rank {
  background: var(--pink);
  color: #fff;
}

.sp-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sp-name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.sp-tag {
  font-size: 10.5px;
  padding: 0 6px;
  height: 17px;
  line-height: 17px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
}

.sp-tag.builtin {
  background: var(--nl-soft);
  color: var(--nl);
}

.sp-tag.warn {
  background: var(--alias-soft);
  color: var(--alias);
}

.sp-move {
  display: flex;
  flex-direction: column;
  opacity: 0;
  transition: opacity 0.15s;
}

.icon-btn.xs {
  width: 18px;
  height: 14px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--muted);
}

.icon-btn.xs:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.icon-btn.xs:disabled {
  opacity: 0.3;
}

.sp-switch {
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: var(--line2);
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s;
}

.sp-switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
  transition: transform 0.25s var(--bounce);
}

.sp-switch.on {
  background: var(--pink);
}

.sp-switch.on span {
  transform: translateX(14px);
}

.sp-summary {
  border-top: 1px solid var(--line);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: var(--panel);
}

.sp-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
}

.sp-feature {
  color: var(--muted);
  flex-shrink: 0;
  width: 52px;
}

.sp-chain {
  flex: 1;
  min-width: 0;
  color: var(--text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-chain.warn,
.sp-size.warn {
  color: var(--alias);
}

.sp-size {
  color: var(--muted);
  flex-shrink: 0;
}

.sp-foot {
  display: flex;
  justify-content: flex-end;
  padding: 8px 10px;
  border-top: 1px solid var(--line);
}
</style>
