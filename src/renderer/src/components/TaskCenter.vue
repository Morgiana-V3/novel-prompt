<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { TASK_LABELS, taskIsActive, type AppTask } from '@shared/tasks'
import { taskState, cancelTask } from '../tasks'
import { cleanErr, state, toast, type Tab } from '../store'
import Icon from './Icon.vue'
import type { IconName } from './icons'

const opened = ref(false), root = ref<HTMLElement>(), panel = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>()
const now = ref(Date.now())
const active = computed(() => taskState.tasks.filter(taskIsActive))
const recent = computed(() => taskState.tasks.filter(t => !taskIsActive(t)))
const statusText = { running: '进行中', cancelling: '正在停止', completed: '已完成', cancelled: '已取消', failed: '未完成' }
const icon = (task: AppTask): IconName => task.status === 'failed' ? 'warn' : task.status === 'completed' ? 'check' : task.status === 'cancelled' ? 'stop' : 'sparkle'
function duration(task: AppTask) {
  const seconds = Math.max(0, Math.floor(((task.endedAt ?? now.value) - task.startedAt) / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function percent(task: AppTask) {
  return task.total && task.total > 0 && task.current !== undefined ? Math.max(0, Math.min(100, task.current / task.total * 100)) : null
}
function visit(task: AppTask) {
  const tab: Tab = task.kind.startsWith('db-') ? 'settings' : task.kind.startsWith('page-') ? 'workspace'
    : task.kind === 'optimize' ? 'ai' : task.kind === 'preview' ? 'preview' : task.kind === 'agent' ? state.tab : 'generate'
  state.tab = tab; opened.value = false
}
async function clear() {
  try { await window.api.tasksClear() } catch (e) { toast(cleanErr(e)) }
}
function outside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node) && !panel.value?.contains(e.target as Node)) opened.value = false
}
function key(e: KeyboardEvent) {
  if (opened.value && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); opened.value = false; trigger.value?.focus() }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key, true) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true) })
</script>

<template>
  <div ref="root" class="task-center">
    <button ref="trigger" class="task-trigger" :class="{working:active.length, opened}" :aria-expanded="opened" aria-controls="task-panel" @click="opened=!opened">
      <Icon :name="active.length ? 'sparkle' : 'layers'" :size="15" :class="{'spin-slow':active.length}" />
      <span>{{ active.length ? `${active.length} 个任务进行中` : '任务' }}</span>
      <span v-if="!active.length && recent.some(t=>t.status==='failed')" class="task-attention" aria-label="有未完成任务"></span>
    </button>
    <Teleport to="body">
      <section v-if="opened" id="task-panel" ref="panel" class="task-panel" aria-label="任务进度">
        <header><div><b>任务</b><span>切换页面，任务继续运行</span></div><button class="icon-btn sm" aria-label="关闭任务面板" @click="opened=false;trigger?.focus()"><Icon name="x" :size="15"/></button></header>
        <div class="task-list scroll">
          <div v-if="!taskState.tasks.length" class="task-empty"><Icon name="layers" :size="30"/><b>暂时没有任务</b><span>AI 分析、图片生成与数据更新的进度<br>都会显示在这里。</span></div>
          <template v-for="group in [{label:'正在进行',tasks:active},{label:'最近结束',tasks:recent}]" :key="group.label">
            <div v-if="group.tasks.length" class="task-section"><span>{{ group.label }} · {{ group.tasks.length }}</span><button v-if="group.tasks===recent" @click="clear">清除记录</button></div>
            <article v-for="task in group.tasks" :key="task.id" class="task-card" :class="task.status" :data-task-id="task.id" :data-kind="task.kind">
              <div class="task-title"><span class="task-icon"><Icon :name="icon(task)" :size="15" :class="{'spin-slow':taskIsActive(task)}"/></span><button @click="visit(task)" title="返回对应页面">{{ task.origin === 'agent' ? 'Agent · ' : '' }}{{ task.label || TASK_LABELS[task.kind] }}</button><span class="task-status">{{ statusText[task.status] }}</span></div>
              <p>{{ task.message }}</p>
              <div v-if="taskIsActive(task)" class="task-meter" :class="{indeterminate:percent(task)===null}" role="progressbar" :aria-label="TASK_LABELS[task.kind]" :aria-valuenow="percent(task)??undefined" aria-valuemin="0" aria-valuemax="100"><i :style="percent(task)!==null ? {width:percent(task)+'%'} : {}"></i></div>
              <footer><span>{{ duration(task) }}<template v-if="percent(task)!==null"> · {{ Math.round(percent(task)!) }}%</template></span><button v-if="taskIsActive(task)" class="task-cancel" :disabled="task.status==='cancelling'" @click="cancelTask(task.id)">{{ task.status==='cancelling' ? '正在停止…' : task.cancelMode==='after-current' ? '本张完成后停止' : '取消任务' }}</button><button v-else class="task-visit" @click="visit(task)">返回页面 <Icon name="arrow" :size="12"/></button></footer>
            </article>
          </template>
        </div>
        <div class="task-footnote">仅保留本次打开期间最近 20 条记录</div>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.task-center{margin-left:auto;-webkit-app-region:no-drag}.task-trigger{display:flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:1px solid var(--line2);border-radius:20px;font-size:12px;color:var(--text2);background:var(--bg)}.task-trigger:hover,.task-trigger.opened{background:var(--hover)}.task-trigger.working{color:var(--pink-deep);border-color:var(--pink-line);background:var(--pink-soft)}.task-attention{width:6px;height:6px;border-radius:50%;background:var(--bad)}
.task-panel{position:fixed;right:24px;top:max(64px,calc(var(--titlebar-safe-height) + 12px));width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 90px);z-index:210;display:flex;flex-direction:column;border:1px solid var(--line2);border-radius:18px;background:var(--bg);box-shadow:0 14px 50px #17121e24;overflow:hidden;-webkit-app-region:no-drag}.task-panel header{padding:18px 18px 15px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--line)}.task-panel header>div{display:flex;flex-direction:column;gap:5px}.task-panel header b{font-size:15px}.task-panel header span{font-size:11px;color:var(--muted)}.task-list{padding:4px 14px 14px;min-height:0}.task-section{display:flex;justify-content:space-between;align-items:center;padding:13px 3px 9px;font-size:10px;color:var(--muted)}.task-section button{color:var(--text2)}.task-section button:hover{color:var(--pink-deep)}
.task-card{padding:13px;margin-bottom:8px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.task-card.running,.task-card.cancelling{border-color:var(--pink-line);background:var(--bg)}.task-title{display:flex;align-items:center;gap:8px}.task-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--pink-soft);color:var(--pink-deep)}.completed .task-icon{color:var(--ok);background:var(--ok-soft)}.failed .task-icon{color:var(--bad);background:var(--bad-soft)}.cancelled .task-icon{color:var(--muted);background:var(--hover)}.task-title>button{font-size:12px;font-weight:600;text-align:left}.task-title>button:hover{color:var(--pink-deep)}.task-status{margin-left:auto;font-size:10px;color:var(--muted)}.running .task-status{color:var(--pink-deep)}.failed .task-status{color:var(--bad)}.task-card p{font-size:11px;color:var(--text2);line-height:1.65;margin:10px 0;overflow-wrap:anywhere;white-space:pre-wrap;user-select:text}.task-card footer{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--muted);margin-top:10px}.task-cancel{border:1px solid var(--line2);border-radius:6px;padding:4px 7px;color:var(--text2);background:var(--bg);font-size:10px}.task-cancel:disabled{opacity:.55;cursor:default}.task-cancel:hover:not(:disabled){color:var(--bad);border-color:var(--bad)}.task-visit{display:flex;align-items:center;gap:4px;color:var(--text2)}.task-meter{height:3px;border-radius:4px;overflow:hidden;background:var(--pink-soft)}.task-meter i{display:block;height:100%;background:var(--pink);border-radius:4px;transition:width .2s}.task-meter.indeterminate i{width:35%;animation:task-progress 1.8s ease-in-out infinite}.task-footnote{padding:10px 18px;border-top:1px solid var(--line);font-size:10px;color:var(--muted);background:var(--panel)}.task-empty{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:36px 12px;color:var(--muted)}.task-empty b{font-size:13px;color:var(--text2)}.task-empty span{font-size:11px;line-height:1.9}
@keyframes task-progress{from{transform:translateX(-110%)}to{transform:translateX(390%)}}@media(prefers-reduced-motion:reduce){.task-meter.indeterminate i{animation:none}}
</style>
