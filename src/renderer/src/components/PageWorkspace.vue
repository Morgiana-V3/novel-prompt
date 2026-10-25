<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PageExecution, PageAction, PageEditorState, PageMessage, PageWorkspace } from '@shared/page-workspace'
import { pageChanges, pageContextKey, pageCurrent } from '@shared/page-workspace'
import { changeLabel } from '@shared/inpaint-plan'
import { cleanErr, state } from '../store'
import { diffPrompt } from '../prompt-diff'
import Icon from './Icon.vue'
import ImageViewport from './ImageViewport.vue'
import InpaintEditor from './InpaintEditor.vue'
import ThemeSelect from './ThemeSelect.vue'
import DiffChips from './DiffChips.vue'
import WorkspacePrompt from './WorkspacePrompt.vue'
import { vAutosize } from '../autosize'

const props = defineProps<{ workspace: PageWorkspace }>()
const emit = defineEmits<{ close: []; updated: [] }>()
const work = ref<PageWorkspace>(props.workspace)
const current = computed(() => pageCurrent(work.value))
const viewedId = ref(work.value.currentVersionId)
const viewed = computed(() => work.value.versions.find(v => v.id === viewedId.value) ?? current.value)
const historical = computed(() => viewed.value.id !== current.value.id)
const regionId = ref<string | null>(null)
const region = computed(() => current.value.editor.regions.find(r => r.id === regionId.value))
const regionOptions = computed(() => [{ value: null as string | null, label: '不附加区域批注' }, ...current.value.editor.regions.map(r => ({ value: r.id, label: `区域 ${r.label}${r.instruction ? ` · ${r.instruction.slice(0, 20)}` : ''}` }))])
const references = ref<string[]>([])
const title = ref(work.value.title), composer = ref(work.value.composer)
const pane = ref<'canvas'|'prompt'|'changes'>('canvas'), editingPrompt = ref(false)
const reviewVersionId = ref(work.value.currentVersionId)
const overlayMode = ref<'annotation'|'execution'>('annotation')
const displayRegion = computed(() => overlayMode.value === 'execution' ? current.value.editor.regions.find(r=>r.id===work.value.execution.regionId) : region.value)
const proposals = computed(() => work.value.messages.filter(m=>m.proposal && m.versionId===reviewVersionId.value).slice().reverse())
const pendingCount = computed(() => proposals.value.filter(m=>m.proposal?.status==='pending' && !stale(m)).length)
const executionRegion = computed(() => current.value.editor.regions.find(r=>r.id===work.value.execution.regionId))
const historyOpen = ref(false), editing = ref(false)
const operation = ref<'chat' | 'generate' | 'save' | ''>('')
const saving = ref(false), error = ref(''), progress = ref(''), zoom = ref(100), overlay = ref('')
const pendingText = ref('')
const showMask = ref(true)
const thread = ref<HTMLElement>(), dialog = ref<HTMLElement>(), viewport = ref<InstanceType<typeof ImageViewport>>()
const input = ref<HTMLTextAreaElement>()
const promptEditor = ref<InstanceType<typeof WorkspacePrompt>>()
const renaming = ref(false), nameInput = ref<HTMLInputElement>(), nameDraft = ref('')
async function startRename() { nameDraft.value=title.value; renaming.value=true; await nextTick(); nameInput.value?.focus(); nameInput.value?.select() }
async function rename() {
  if (!renaming.value) return
  title.value=nameDraft.value.trim() || title.value; renaming.value=false
  try { await flushNotes() } catch(e) { error.value=cleanErr(e) }
}
const previousFocus = document.activeElement as HTMLElement | null
let notesTimer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<unknown> = Promise.resolve()
let unsubscribe: (() => void) | undefined
let alive = true
const busy = computed(() => !!operation.value || editingPrompt.value)
const notesValue = () => ({ type: 'notes' as const, title: title.value, goal: work.value.goal, preserve: work.value.preserve, composer: composer.value })
const savedNotes = ref(JSON.stringify(notesValue()))
const label = (id: string) => work.value.versions.find(v => v.id === id)?.label ?? '历史版本'
function shortVersion(id: string) { const v=work.value.versions.find(v=>v.id===id); if(!v)return '历史'; const index=work.value.versions.indexOf(v); return index===0 ? (v.image?'原稿':'起点') : `版本 ${index}` }
function versionDetail(v: PageWorkspace['versions'][number]) { return [v.label,v.parentId?`来源：${label(v.parentId)}`:'',v.generated?`${v.generated.execution.kind==='inpaint'?'局部重绘':'提示词生成'} · 种子 ${v.generated.params.seed}`:''].filter(Boolean).join('\n') }
const time = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const status = (s: string) => ({ pending: '待采纳', accepted: '已采纳', rejected: '未采纳', withdrawn: '已撤销' }[s] ?? s)
function stale(m: PageMessage) { return !!m.proposal && (m.versionId !== current.value.id || m.proposal.contextKey !== pageContextKey(current.value, m.proposal.regionId, work.value)) }
async function cancelChat() { try { await window.api.pagesCancel(work.value.id) } catch (e) { error.value = cleanErr(e) } }
function mutate(action: PageAction): Promise<void> {
  const next = chain.catch(() => {}).then(async () => {
    saving.value = true
    try { work.value = await window.api.pagesEdit(work.value.id, work.value.revision, JSON.parse(JSON.stringify(action))); emit('updated') }
    finally { saving.value = false }
  })
  chain = next
  return next
}
async function flushNotes() {
  clearTimeout(notesTimer)
  const value = notesValue(), key = JSON.stringify(value)
  if (key !== savedNotes.value) { await mutate(value); savedNotes.value = key }
  else await chain
}
watch([title, composer], () => {
  clearTimeout(notesTimer)
  if (busy.value) return
  notesTimer = setTimeout(() => { void flushNotes().catch(e => { error.value = `尚未保存：${cleanErr(e)}` }) }, 500)
})
async function saveEditor(editor: PageEditorState) { await mutate({ type: 'editor', versionId: current.value.id, editor }) }
async function openEditor() {
  if (busy.value) return
  operation.value = 'save'
  try { await flushNotes(); viewedId.value = current.value.id; editing.value = true } catch (e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
}
async function closeEditor() {
  editing.value = false
  if (!regionId.value || !current.value.editor.regions.some(r => r.id === regionId.value)) regionId.value = current.value.editor.regions[0]?.id ?? null
  overlayMode.value = 'annotation'; await refreshOverlay()
}
async function send() {
  if (busy.value || !composer.value.trim()) return
  error.value = ''; operation.value = 'chat'
  try {
    await flushNotes()
    const text = composer.value
    pendingText.value = text
    composer.value = ''
    await scrollEnd()
    work.value = await window.api.pagesChat(work.value.id, work.value.revision, text, regionId.value, [...references.value])
    references.value = []; if(work.value.messages.at(-1)?.proposal) review(current.value.id); savedNotes.value = JSON.stringify(notesValue()); emit('updated')
  } catch (e) {
    error.value = cleanErr(e)
    try { work.value = await window.api.pagesRead(work.value.id); composer.value = work.value.composer; savedNotes.value = JSON.stringify(notesValue()) } catch { /* Preserve local state if reading also fails. */ }
  } finally { pendingText.value = ''; operation.value = ''; await scrollEnd(); input.value?.focus() }
}
async function proposal(m: PageMessage, decision: 'accept' | 'reject' | 'undo') {
  if (busy.value) return
  error.value = ''; operation.value = 'save'
  try { await flushNotes(); await mutate({ type: 'proposal', messageId: m.id, decision }); if (m.proposal?.regionId) regionId.value = m.proposal.regionId }
  catch (e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
}
async function setExecution(execution: PageExecution) {
  if(busy.value)return
  operation.value='save';error.value=''
  try { await flushNotes(); await mutate({type:'execution',execution}); overlayMode.value='execution'; pane.value='canvas' }
  catch(e){error.value=cleanErr(e)} finally{operation.value=''}
}
function chooseExecution(kind: 'generate'|'inpaint') {
  void setExecution({kind,regionId:kind==='inpaint' ? work.value.execution.regionId ?? current.value.editor.regions[0]?.id ?? null : null})
}
function planLabel(e?: PageExecution) { return e?.kind === 'inpaint' ? '局部重绘 · '+(work.value.versions.find(v=>v.id===reviewVersionId.value)?.editor.regions.find(r=>r.id===e.regionId)?.label ?? '遮罩已不存在') : '按提示词生成新图' }
function review(id: string) { reviewVersionId.value=id; pane.value='changes' }
function inspectMask() { overlayMode.value='execution';showMask.value=true;viewedId.value=current.value.id;pane.value='canvas' }

async function generate() {
  if (busy.value || work.value.execution.kind==='inpaint' && !executionRegion.value) return
  error.value = ''; progress.value = '正在检查重绘参数…'; operation.value = 'generate'
  try {
    await flushNotes()
    work.value = await window.api.pagesGenerate(work.value.id, work.value.revision, JSON.parse(JSON.stringify(work.value.execution)))
    viewedId.value = current.value.id; pane.value = 'canvas'; if(!current.value.editor.regions.some(r=>r.id===regionId.value))regionId.value=null; emit('updated')
  } catch (e) { error.value = cleanErr(e); try { work.value = await window.api.pagesRead(work.value.id) } catch { /* Keep existing state. */ } }
  finally { operation.value = ''; progress.value = ''; await scrollEnd() }
}
async function continueVersion(id: string) {
  if (busy.value) return
  operation.value = 'save'
  try { await flushNotes(); await mutate({ type: 'switch', versionId: id }); viewedId.value = id; regionId.value = null; await scrollEnd() }
  catch (e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
}
function reference(id: string) {
  if (references.value.includes(id)) references.value = references.value.filter(x => x !== id)
  else if (references.value.length < 2) references.value.push(id)
  else error.value = '一次最多引用两个版本，请先移除一个引用'
  input.value?.focus()
}
async function scrollEnd() { await nextTick(); if (thread.value) thread.value.scrollTop = thread.value.scrollHeight }
let overlayEpoch = 0
async function refreshOverlay() {
  const epoch = ++overlayEpoch; overlay.value = ''
  if (!displayRegion.value || historical.value) return
  const img = new Image(); img.src = `data:image/png;base64,${displayRegion.value.mask}`
  try {
    await img.decode(); if (!alive || epoch !== overlayEpoch) return
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height)
    for (let i = 0; i < data.data.length; i += 4) { const alpha = data.data[i]; data.data.set([255, 107, 154, alpha], i) }
    ctx.putImageData(data, 0, 0); overlay.value = c.toDataURL('image/png')
  } catch { error.value = '选区预览读取失败，请在选区编辑器中检查' }
}
watch([displayRegion, viewedId, () => current.value.id], refreshOverlay)
watch(viewedId, async () => { zoom.value = 100; await nextTick(); viewport.value?.reset() })
async function prepareLeave(): Promise<boolean> {
  if (busy.value || editing.value || renaming.value) { error.value='请先完成当前编辑或操作，再从生图预览选择会话图片。'; return false }
  try { await flushNotes(); return true } catch(e) { error.value=cleanErr(e); return false }
}
defineExpose({ prepareLeave })
async function close() {
  if (busy.value || editing.value) return
  try { await flushNotes(); emit('close') } catch (e) { error.value = `保存失败，窗口暂未关闭：${cleanErr(e)}` }
}
function key(e: KeyboardEvent) {
  if (editing.value || state.tab !== 'workspace' || document.querySelector('.pos-mask')) return
  if (e.key === 'Escape') { e.preventDefault(); if(historyOpen.value)historyOpen.value=false }

}
onMounted(() => { window.addEventListener('keydown', key); unsubscribe = window.api.onNaiStep(s => { if (operation.value === 'generate') progress.value = s }); void scrollEnd() })
onBeforeUnmount(() => { alive = false; clearTimeout(notesTimer); window.removeEventListener('keydown', key); unsubscribe?.(); previousFocus?.focus() })
</script>

<template>
  <section class="pw-shell" aria-label="AI 创作会话" ref="dialog">
    <header class="pw-header">
      <button class="btn ghost small" :disabled="busy || editing" title="保存并返回会话列表" @click="close">返回会话</button>
      <div class="pw-heading">
        <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="input sm" maxlength="100" aria-label="会话名称" @keydown.enter.prevent="rename" @keydown.esc.stop="renaming=false" @blur="rename">
        <button v-else class="pw-rename" :disabled="busy" title="重命名会话" @click="startRename"><b>{{ title }}</b><Icon name="edit" :size="14" /></button>
      </div>
      <span class="pill">{{ work.model.toUpperCase() }}</span>
      <button class="btn ghost small" @click="historyOpen=!historyOpen"><Icon name="layers" :size="14"/>历史 {{ work.versions.length }}</button>
    </header>
    <div class="pw-main">
      <aside v-if="historyOpen" class="pw-history scroll"><div class="pw-section-title">历史</div><button v-for="v in work.versions.slice().reverse()" :key="v.id" class="pw-version" :disabled="editingPrompt" :class="{selected:viewedId===v.id}" :title="versionDetail(v)" @click="viewedId=v.id;pane='canvas'"><img v-if="v.image" :src="v.image.url" alt="" loading="lazy"><div v-else class="pw-version-empty"><Icon name="chat"/></div><div><b :title="v.label">{{ shortVersion(v.id) }}</b><span v-if="v.id===current.id" class="pw-current">当前采用</span></div></button></aside>
      <div class="pw-canvas-column">
        <div class="pw-toolbar"><div class="pw-view-tabs seg"><button :class="{on:pane==='canvas'}" :disabled="editingPrompt" @click="pane='canvas'">画布</button><button :class="{on:pane==='prompt'}" @click="pane='prompt'">当前提示词</button><button :class="{on:pane==='changes'}" :disabled="editingPrompt" @click="review(current.id)">修改对比 <span v-if="pendingCount">{{ pendingCount }}</span></button></div><div v-if="pane==='prompt'" class="pw-prompt-actions">
          <template v-if="editingPrompt"><button class="btn ghost small" :disabled="promptEditor?.saving" @click="promptEditor?.cancel()">取消编辑</button><button class="btn primary small" :disabled="promptEditor?.saving" @click="promptEditor?.save()">{{ promptEditor?.saving?'保存中…':'保存草稿' }}</button></template>
          <template v-else><button class="icon-btn sm" title="复制完整提示词" @click="promptEditor?.copyPrompt()"><Icon name="copy" :size="15"/></button><button class="btn small" :disabled="busy" @click="promptEditor?.begin()"><Icon name="edit" :size="14"/>编辑</button></template>
        </div></div>
        <template v-if="pane==='canvas'">
          <div class="pw-canvas-bar"><div><b>{{ viewed.label }}</b><span v-if="viewed.image" class="muted small">{{ viewed.image.width }} × {{ viewed.image.height }}</span></div><button v-if="viewed.image" class="btn ghost small" @click="viewport?.reset()">{{ zoom }}% · 适应画布</button></div>
          <div v-if="historical" class="pw-history-banner"><span>查看历史 · 当前采用「{{ current.label }}」</span><div><button v-if="viewed.image" class="btn small" :disabled="busy" @click="reference(viewed.id)">引用此版</button><button class="btn small primary" :disabled="busy" @click="continueVersion(viewed.id)">从此版继续</button></div></div>
          <ImageViewport v-if="viewed.image" ref="viewport" class="pw-viewport" :width="viewed.image.width||1" :height="viewed.image.height||1" v-model:zoom="zoom" label="创作画布"><img :src="viewed.image.url" :alt="viewed.label" draggable="false"><img v-if="overlay && showMask && !historical" class="pw-overlay" :src="overlay" alt="区域标记" draggable="false"></ImageViewport>
          <div v-else class="pw-blank"><Icon name="image" :size="40"/><span>暂无图片</span></div>
          <div v-if="current.image" class="pw-canvas-actions"><button class="btn accent small" :disabled="busy" @click="openEditor"><Icon name="edit" :size="14"/>区域批注 / 遮罩</button><button v-if="overlay&&!historical" class="btn ghost small" @click="showMask=!showMask">{{ showMask?'隐藏标记':'显示标记' }}</button><span v-if="displayRegion&&!historical" class="muted small">{{ overlayMode==='execution'?'执行遮罩':'说明区域' }} {{ displayRegion.label }}</span></div>

          <details v-if="historical" class="pw-historical-prompt scroll"><summary>此版本的提示词与参数</summary><pre>{{ JSON.stringify(viewed.generated ?? viewed.editor, (k,v)=>k==='regions'||k==='mask'?undefined:v, 2) }}</pre></details>
        </template>
        <WorkspacePrompt ref="promptEditor" v-else-if="pane==='prompt'" :key="current.id" :editor="current.editor" :model="work.model" :image="current.image" :baseline="current.generated?.draft" :has-image="!!current.image" :disabled="busy" :save="saveEditor" @editing="editingPrompt=$event" />
        <div v-else class="pw-change-board scroll"><div class="row"><h3>修改记录 · {{ shortVersion(reviewVersionId) }}</h3><button v-if="reviewVersionId!==current.id" class="btn ghost small ml-auto" @click="review(current.id)">回到当前版本</button></div>
          <p v-if="!proposals.length && !work.messages.some(m=>m.draftBefore&&m.versionId===reviewVersionId)" class="pw-empty-plan">暂无修改方案</p>
          <article v-for="m in proposals" :key="m.id" class="pw-proposal"><div class="row"><b>{{ m.proposal!.title }}</b><span class="pill ml-auto">{{ status(m.proposal!.status) }}</span></div><p class="pw-plan-kind">建议执行：{{ planLabel(m.proposal!.execution) }}</p><p v-if="m.proposal!.warning" class="pw-warning">{{ m.proposal!.warning }}</p><div v-for="(c,i) in m.proposal!.changes" :key="i" class="pw-change"><label>{{ changeLabel(c) }}</label><DiffChips :diff="diffPrompt(c.before,c.after)"/><p v-if="c.reason">{{ c.reason }}</p><details v-if="c.before||c.after"><summary>完整修改前后</summary><pre>{{ c.before||'（空）' }}</pre><pre>{{ c.after||'（空）' }}</pre></details></div><p v-if="!m.proposal!.changes.length" class="muted small">保持当前提示词，使用上述执行方式继续尝试。</p><p v-if="m.proposal!.status==='pending'&&stale(m)" class="muted small">上下文或执行设置已改变，请基于当前状态重新提出方案。</p><div v-if="m.proposal!.status==='pending'" class="row"><button class="btn small primary" :disabled="busy||stale(m)" @click="proposal(m,'accept')">采纳方案</button><button class="btn ghost small" :disabled="busy" @click="proposal(m,'reject')">不采用</button></div><button v-if="m.proposal!.status==='accepted'" class="btn ghost small" :disabled="busy||m.versionId!==current.id" @click="proposal(m,'undo')">撤销采纳</button></article>
          <details v-for="m in work.messages.filter(m=>m.draftBefore&&m.versionId===reviewVersionId).slice().reverse()" :key="m.id" class="pw-proposal"><summary>{{ m.text }} · {{ time(m.createdAt) }}</summary><div v-for="(c,i) in pageChanges(m.draftBefore!,m.draftAfter!)" :key="i" class="pw-change"><label>{{ changeLabel(c) }}</label><DiffChips :diff="diffPrompt(c.before,c.after)"/><p v-if="c.reason">{{ c.reason }}</p></div></details>
        </div>
        <div class="pw-execution" :title="work.execution.kind==='generate' ? '使用当前提示词重新生成整张图' : '以当前图片为底图，仅重绘所选遮罩'"><div class="row"><b>本次执行</b><ThemeSelect :model-value="work.execution.kind" :disabled="busy" :options="[{value:'generate',label:'按提示词生成新图'},{value:'inpaint',label:'局部重绘当前图片',disabled:!current.image||!current.editor.regions.length}]" @update:model-value="chooseExecution" /></div><div v-if="work.execution.kind==='inpaint'" class="row"><ThemeSelect :model-value="work.execution.regionId" :disabled="busy" :options="current.editor.regions.map(r=>({value:r.id,label:'遮罩 '+r.label}))" @update:model-value="id=>setExecution({kind:'inpaint',regionId:id})"/><button class="btn small ghost" @click="inspectMask">检查遮罩</button></div><div class="row"><span class="muted small">{{ current.editor.params.width }}×{{ current.editor.params.height }} · {{ current.editor.params.steps }} 步</span><button class="btn accent ml-auto" :disabled="busy || !current.editor.draft.base.trim()&&!current.editor.draft.characters.some(c=>c.prompt.trim())" @click="generate"><Icon name="wand" :size="14"/>{{ operation==='generate'?'正在执行…':work.execution.kind==='generate'?'生成新版本':'执行局部重绘' }}</button></div></div>
      </div>
      <aside class="pw-conversation"><div class="pw-thread-header"><div><Icon name="sparkle" :size="17"/><b>对话</b></div><span :title="state.settings?.model">{{ state.settings?.model || '请先配置 AI' }}</span></div><div class="pw-context"><span class="pw-context-dot"></span>当前采用 <b>{{ current.label }}</b><button v-if="historical" @click="viewedId=current.id">回到当前</button></div>
        <div class="pw-thread scroll" ref="thread" aria-live="polite"><div v-if="!work.messages.some(m=>m.role==='user')&&!pendingText" class="pw-welcome"><p>描述想生成或修改的内容</p></div>
          <div v-for="m in work.messages" :key="m.id" :class="['pw-message',m.role,{failed:m.error}]"><template v-if="m.role==='event'"><span>{{ m.text }}</span></template><template v-else><div class="pw-message-meta"><b>{{ m.role==='user'?'你':'AI' }}</b><button :disabled="editingPrompt" @click="viewedId=m.versionId;pane='canvas'">{{ label(m.versionId) }}</button><time>{{ time(m.createdAt) }}</time></div><div class="pw-message-text">{{ m.text }}</div><div v-if="m.referenceIds?.length" class="pw-citations"><button v-for="id in m.referenceIds" :key="id" :disabled="editingPrompt" @click="viewedId=id;pane='canvas'">引用 {{ label(id) }}</button></div><button v-if="m.proposal" class="pw-plan-link" :disabled="editingPrompt" @click="review(m.versionId)">{{ m.proposal.title }} · {{ status(m.proposal.status) }} → 查看修改对比</button><details v-if="m.skills" class="pw-used-skills"><summary>本轮 Skill · {{ m.skills.length }}</summary>{{ m.skills.join('、') || '未启用 Skill' }}</details></template></div>
          <div v-if="pendingText" class="pw-message user"><div class="pw-message-text">{{ pendingText }}</div></div><div v-if="operation==='chat'" class="pw-thinking"><Icon name="sparkle" :size="16" class="spin-slow"/>正在分析上下文…<button @click="cancelChat">停止</button></div><div v-if="operation==='generate'" class="pw-thinking">{{ progress }}</div>
        </div>
        <div class="pw-compose"><div v-if="error" class="pw-error" role="alert">{{ error }}<button @click="error=''">×</button></div><div v-if="references.length" class="pw-reference-chips"><button v-for="id in references" :key="id" :disabled="busy" @click="reference(id)">引用 {{ label(id) }} ×</button></div><div v-if="current.editor.regions.length" class="pw-target"><ThemeSelect v-model="regionId" :options="regionOptions" :disabled="busy" aria-label="附加区域批注" @update:model-value="overlayMode='annotation'"/></div><div class="pw-input-wrap"><textarea v-autosize ref="input" v-model="composer" :disabled="busy" maxlength="6000" aria-label="持续讨论输入" placeholder="描述目标，或接着上次的结果继续说…" @keydown.enter.exact.prevent="!$event.isComposing&&send()"></textarea><button class="pw-send" :disabled="busy||!composer.trim()" title="发送" @click="send"><Icon name="arrow" :size="18"/></button></div></div>
      </aside>
    </div>
    <InpaintEditor v-if="editing&&current.image" :image="current.image" :params="current.editor.params" :initial-editor="current.editor" :initial-model="work.model" :initial-region-id="regionId" :save-editor="saveEditor" selection-only @close="closeEditor"/>
  </section>
</template>

<style scoped>
.pw-shell{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bg);outline:none}
.pw-header{height:46px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:6px 18px;border-bottom:1px solid var(--line)}
.pw-heading{min-width:0;flex:1}.pw-rename{display:flex;align-items:center;gap:8px;max-width:100%;padding:5px 8px;border:1px solid transparent;border-radius:8px;text-align:left}.pw-rename b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pw-rename .icon{flex-shrink:0;color:var(--muted)}.pw-rename:hover,.pw-rename:focus-visible{background:var(--hover);border-color:var(--line2)}.pw-heading input{width:100%;max-width:360px}
.pw-notes{padding:16px 24px;background:var(--panel);border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;flex-shrink:0}.pw-notes label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text2)}.pw-notes textarea{height:64px;min-height:64px;resize:none}.pw-notes p{grid-column:1/-1;margin:0;font-size:11px;color:var(--muted)}
.pw-main{display:flex;flex:1;min-height:0}.pw-history{width:172px;flex-shrink:0;background:var(--side);padding:16px 12px;border-right:1px solid var(--line)}.pw-section-title{font-size:12px;font-weight:650;margin:0 0 12px}.pw-section-title span{color:var(--muted);font-size:10px;font-weight:400;margin-left:6px}.pw-version{width:100%;text-align:left;padding:7px;border:1px solid transparent;border-radius:12px;margin-bottom:10px}.pw-version:hover{background:var(--hover)}.pw-version.selected{border-color:var(--pink-line);background:var(--pink-soft)}.pw-version img{width:100%;height:98px;object-fit:contain;border-radius:6px;background:var(--bg)}.pw-version div{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:6px}.pw-version b{font-size:12px}.pw-version small{width:100%;font-size:10px;color:var(--muted)}.pw-current{font-size:9px;color:var(--pink-deep);margin-left:auto}
.pw-canvas-column{flex:1;min-width:240px;display:flex;flex-direction:column;background:var(--panel);padding:0 18px}.pw-canvas-bar{display:flex;justify-content:space-between;align-items:center;height:54px;flex-shrink:0}.pw-canvas-bar>div{display:flex;gap:12px;align-items:center}.pw-canvas-bar b{font-size:13px}.pw-viewport{flex:1;min-height:120px;border:1px solid var(--line2);border-radius:12px;background:var(--side)}.pw-overlay{opacity:.32;pointer-events:none}.pw-canvas-actions{display:flex;gap:10px;align-items:center;padding:15px 0;flex-shrink:0}.pw-regions{display:flex;gap:6px;padding-bottom:15px;flex-wrap:wrap}.pw-regions button{font-size:11px;padding:5px 11px;background:var(--bg);border:1px solid var(--line2);border-radius:20px}.pw-regions .on{background:var(--pink-soft);border-color:var(--pink-line);color:var(--pink-deep)}.pw-regions i{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--ok);margin-left:5px}.pw-history-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;font-size:11px;padding:10px;margin-bottom:10px;border:1px solid var(--pink-line);border-radius:10px;background:var(--pink-soft)}.pw-history-banner>div{display:flex;gap:8px}
.pw-conversation{width:380px;min-width:310px;max-width:46%;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--bg)}.pw-thread-header{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;flex-shrink:0}.pw-thread-header>div{display:flex;gap:8px;align-items:center;font-size:14px}.pw-thread-header .icon{color:var(--pink)}.pw-thread-header>span{display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 0 auto;font-size:11px;color:var(--muted)}.pw-context{display:flex;align-items:center;gap:7px;margin:0 20px 12px;padding:9px 11px;border-radius:9px;background:var(--panel);font-size:11px;color:var(--text2);flex-shrink:0}.pw-context b{color:var(--text)}.pw-context button{margin-left:auto;color:var(--pink-deep);font-size:10px}.pw-context-dot{width:6px;height:6px;background:var(--pink);border-radius:50%}.pw-thread{flex:1;min-height:0;padding:6px 20px 20px;scroll-behavior:smooth}.pw-welcome{padding:28px 2px 12px}.pw-welcome-icon{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:17px;background:var(--pink-soft);color:var(--pink);margin-bottom:16px}.pw-welcome h2{font-size:19px}.pw-welcome p{font-size:12px;color:var(--text2);line-height:1.9;margin:12px 0 20px}.pw-welcome>button{display:flex;align-items:center;justify-content:space-between;text-align:left;gap:10px;width:100%;padding:12px 14px;margin:8px 0;font-size:12px;border:1px solid var(--line2);border-radius:12px;line-height:1.6}.pw-welcome>button:hover{border-color:var(--pink-line);background:var(--pink-soft)}
.pw-message{margin:16px 0;font-size:12px;line-height:1.8}.pw-message-meta{display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:10px;color:var(--muted)}.pw-message-meta b{color:var(--text2);font-size:11px}.pw-message-meta button{font-size:10px;background:var(--panel);border-radius:5px;padding:0 5px}.pw-message-meta time{margin-left:auto}.pw-message-text{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.pw-message.user .pw-message-text{background:var(--pink-soft);border-radius:12px 3px 12px 12px;padding:11px 14px}.pw-message.event{font-size:10px;color:var(--muted);border-left:2px solid var(--line2);padding-left:10px}.pw-message.event.failed{color:var(--bad)}.pw-proposal{border:1px solid var(--pink-line);border-radius:12px;padding:13px;margin-top:12px;background:var(--bg)}.pw-proposal>.row>b{font-size:12px}.pw-proposal .pill{font-size:9px}.pw-warning{color:var(--alias);font-size:11px;white-space:pre-wrap}.pw-change{border-top:1px solid var(--line);padding:12px 0}.pw-change label{font-weight:600;font-size:11px}.pw-change p{font-size:11px;color:var(--text2);margin:8px 0 0}.pw-change details{font-size:10px;color:var(--muted);margin-top:8px}.pw-change summary{cursor:pointer}.pw-change pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:var(--panel);padding:8px;border-radius:8px;font:10px/1.7 var(--mono);user-select:text}.pw-citations{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.pw-citations button{font-size:10px;color:var(--pink-deep);display:flex;align-items:center;gap:4px}.pw-thinking{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--text2);padding:15px 0}.pw-thinking button{color:var(--pink-deep);margin-left:auto;flex-shrink:0}
.pw-compose{padding:12px 16px 16px;border-top:1px solid var(--line);flex-shrink:0;background:var(--bg)}.pw-target{display:flex;gap:8px;align-items:center;margin-bottom:10px}.pw-target>:first-child{flex:1;min-width:0}.pw-input-wrap{border:1px solid var(--line2);border-radius:14px;padding:10px 10px 8px;background:var(--panel);display:flex;align-items:flex-end;gap:8px}.pw-input-wrap:focus-within{border-color:var(--pink-line);box-shadow:0 0 0 3px var(--pink-soft)}.pw-input-wrap textarea{border:0;outline:none;box-shadow:none;background:transparent;resize:none;min-height:50px;max-height:180px;flex:1;min-width:0;font-size:12px;line-height:1.8}.pw-send{width:32px;height:32px;border-radius:11px;background:var(--pink);color:white;display:grid;place-items:center;flex-shrink:0}.pw-send:disabled{opacity:.4}.pw-compose-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;min-height:30px}.pw-compose-foot>span{font-size:10px;color:var(--muted)}.pw-reference-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.pw-reference-chips button{font-size:10px;padding:5px 8px;border-radius:7px;background:var(--pink-soft);color:var(--pink-deep);display:flex;gap:5px;align-items:center}.pw-error{font-size:11px;background:var(--bad-soft);color:var(--bad);padding:8px 10px;border-radius:8px;margin-bottom:10px;white-space:pre-wrap;overflow-wrap:anywhere;display:flex;justify-content:space-between;gap:10px}.pw-error button{flex-shrink:0}
@media(max-width:1050px){.pw-conversation{width:370px;min-width:320px;max-width:48%}.pw-history{width:130px}.pw-canvas-column{padding:0 12px}.pw-header{padding:6px 12px;gap:8px}.pw-canvas-actions>.muted{display:none}}
@media(max-width:800px){.pw-history{position:absolute;left:0;top:46px;bottom:0;z-index:4;box-shadow:var(--shadow);width:170px}.pw-conversation{width:340px;max-width:52%;min-width:280px}.pw-header>.pill{display:none}.pw-header .btn{font-size:11px}.pw-thread{padding:6px 12px 15px}.pw-notes{padding:12px}}
.pw-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;min-height:52px;padding:8px 0;flex-wrap:wrap}.pw-view-tabs{margin:0;flex-shrink:0}.pw-prompt-actions{display:flex;align-items:center;gap:6px;margin-left:auto}.pw-execution>.row:last-child{margin-top:10px}.pw-execution{padding:14px 0;border-top:1px solid var(--line);flex-shrink:0}.pw-execution>.row{gap:10px;flex-wrap:wrap}.pw-execution>.row+.row{margin-top:8px}.pw-execution b{font-size:12px}.pw-execution p{font-size:11px;color:var(--text2);line-height:1.7;margin:8px 0}.pw-execution :deep(.theme-select){min-width:160px;flex:1}.pw-blank{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);gap:15px;text-align:center;padding:20px}.pw-blank p{font-size:12px;line-height:1.8}.pw-change-board{flex:1;min-height:0;padding:16px 0}.pw-change-board>h3{font-size:14px}.pw-change-board>.pw-proposal{margin:15px 0}.pw-plan-kind{font-size:12px;color:var(--pink-deep)}.pw-empty-plan{margin:50px 10px;color:var(--muted);font-size:13px}.pw-plan-link{display:block;padding:10px 12px;margin-top:10px;border:1px solid var(--pink-line);border-radius:10px;text-align:left;font-size:11px;color:var(--pink-deep)}.pw-locator-help{font-size:10px;color:var(--muted);margin:0 0 12px}.pw-understanding{padding:14px 24px;background:var(--panel);border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;max-height:180px;overflow:auto;flex-shrink:0}.pw-understanding p{white-space:pre-wrap;line-height:1.7;margin:5px 0}.pw-understanding>span{grid-column:1/-1;color:var(--muted);font-size:11px}.pw-used-skills{font-size:10px;color:var(--muted);margin-top:8px}.pw-version-empty{height:70px;display:grid;place-items:center;color:var(--pink)}.pw-historical-prompt{max-height:160px;font-size:11px;margin-bottom:10px;flex-shrink:0}.pw-historical-prompt pre,.pw-change-board pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.pw-history{max-width:18%}
.pw-change>label{display:block;margin-bottom:8px}.pw-change :deep(.diff-row){padding:0;margin:0 0 10px}.pw-change :deep(.diff-prose){margin:10px 0}.pw-version b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pw-current{flex-shrink:0}.pw-version>div{min-width:0}
</style>
