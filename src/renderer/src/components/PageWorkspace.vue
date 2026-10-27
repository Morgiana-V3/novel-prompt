<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PageExecution, PageAction, PageEditorState, PageMessage, PageWorkspace, PageAgentIdentity } from '@shared/page-workspace'
import { pageComparison, pageGroups, pageContextKey, pageCurrent, pageLatestProposal } from '@shared/page-workspace'
import { changeLabel } from '@shared/inpaint-plan'
import { cleanErr, state, copy } from '../store'
import { diffPrompt } from '../prompt-diff'
import Icon from './Icon.vue'
import ImageViewport from './ImageViewport.vue'
import InpaintEditor from './InpaintEditor.vue'
import ThemeSelect from './ThemeSelect.vue'
import DiffChips from './DiffChips.vue'
import WorkspacePrompt from './WorkspacePrompt.vue'
import WorkspaceIterations from './WorkspaceIterations.vue'
import MarkdownText from './MarkdownText.vue'
import { vAutosize } from '../autosize'
import { taskState, cancelTask } from '../tasks'
import { taskIsActive } from '@shared/tasks'
import { patchWorkspaceConfig } from '@shared/workspace-config'

const props = defineProps<{ workspace: PageWorkspace }>()
const inpaintEditor = ref<InstanceType<typeof InpaintEditor>>()
let frontendContext: import('@shared/desktop').FrontendContext | undefined
const emit = defineEmits<{ close: []; updated: [] }>()
const work = ref<PageWorkspace>(props.workspace)
const current = computed(() => pageCurrent(work.value))
const viewedId = ref(work.value.currentVersionId)
const viewed = computed(() => work.value.versions.find(v => v.id === viewedId.value) ?? current.value)
const groups = computed(() => pageGroups(work.value).slice().reverse())
const viewedGroup = computed(() => groups.value.find(g => g.versions.some(v => v.id === viewed.value.id))!)
const viewedCandidates = computed(() => viewedGroup.value.versions.filter(v => !v.imageCleared))
const groupCards = computed(() => groups.value.map(g => ({ ...g,
  cover: g.versions.find(v => v.id === viewedId.value) ?? g.versions.find(v => v.id === current.value.id) ?? g.versions[g.versions.length - 1],
  adopted: g.versions.some(v => v.id === current.value.id)
})))
async function recoverImage() {
  if(busy.value)return
  operation.value='save'
  try { await flushNotes(); const w = await window.api.pagesRecoverImage(work.value.id, work.value.revision, viewed.value.id); if(w) { work.value=w; emit('updated') } } catch(e) {error.value=cleanErr(e)} finally {operation.value=''}
}
const historical = computed(() => viewed.value.id !== current.value.id)
const regionId = ref<string | null>(null)
const region = computed(() => current.value.editor.regions.find(r => r.id === regionId.value))
const regionOptions = computed(() => [{ value: null as string | null, label: '不附加区域批注' }, ...current.value.editor.regions.map(r => ({ value: r.id, label: `区域 ${r.label}${r.instruction ? ` · ${r.instruction.slice(0, 20)}` : ''}` }))])
const references = ref<string[]>([])
const title = ref(work.value.title), composer = ref(work.value.composer)
const pane = ref<'canvas'|'prompt'|'changes'|'images'>('canvas'), editingPrompt = ref(false)
const configDraft = ref<PageEditorState | null>(null)
const configOwner = ref<string | null>(null)
const cloneEditor = (e: PageEditorState): PageEditorState => JSON.parse(JSON.stringify(e))
const nextEditor = computed(() => configDraft.value ?? current.value.editor)
const snapshotEditor = computed(() => {
  const v=viewed.value, recipe=v.generated ?? v.initial
  return recipe ? cloneEditor({model:recipe.model ?? v.editor.model ?? work.value.model,draft:recipe.draft,params:recipe.params,regions:[],strength:v.generated?.inpaint?.strength ?? 1}) : null
})
const configSizeLocked = computed(() => work.value.execution.kind==='inpaint' || !!nextEditor.value.regions.length)
const compareOptions = computed(() => [{value:'',label:'生成来源'},...work.value.versions.filter(v=>v.id!==viewed.value.id&&(v.generated||!v.parentId)).slice().reverse().map(v=>({value:v.id,label:v.label}))])
const reviewVersionId = computed(() => viewed.value.id)
const compareVersionId = ref('')
const comparison = computed(() => pageComparison(work.value, viewed.value.id, compareVersionId.value))
watch(viewedId, () => { compareVersionId.value = ''; selectedProposalId.value = null }, { flush: 'sync' })
const selectedProposalId = ref<string | null>(null)
const discussionVersion = viewed
const connections = ref<PageAgentIdentity[]>([])
let offAgents: (() => void) | undefined
const external = computed(() => work.value.agentMode === 'external')
const agentConnected = computed(() => connections.value.some(a => a.sessionId === work.value.externalAgent?.sessionId))
const pendingRequest = computed(() => work.value.messages.find(m => m.externalRequest?.status === 'pending'))
const agentActivity = computed(() => pendingRequest.value ? connections.value.find(a => a.sessionId === work.value.externalAgent?.sessionId)?.activity?.find(a => a.workspaceId === work.value.id && a.requestId === pendingRequest.value!.id) : undefined)
const agentStatus = computed(() => !agentConnected.value ? (work.value.externalAgent ? '连接已断开' : '等待连接') : agentActivity.value ? 'Agent 正在处理' : pendingRequest.value ? '等待 Agent 处理' : '已连接 · 待命')
const discussionContext = computed(() => {
  const request = pendingRequest.value
  const versionId = request ? request.discussion?.versionId ?? request.versionId : discussionVersion.value.id
  const editVersionId = request?.versionId ?? current.value.id
  return { versionId, label: request?.discussion?.label ?? label(versionId), editVersionId, editLabel: label(editVersionId) }
})
const agentLabel = computed(() => external.value ? work.value.externalAgent?.name ?? '外部 Agent' : state.settings?.model || '内置 AI')
const overlayMode = ref<'annotation'|'execution'>('annotation')
const displayRegion = computed(() => overlayMode.value === 'execution' ? current.value.editor.regions.find(r=>r.id===work.value.execution.regionId) : region.value)
const executionRegion = computed(() => current.value.editor.regions.find(r=>r.id===work.value.execution.regionId))
const historyOpen = ref(false), editing = ref(false)
const clearingImage = ref<string | null>(null)
watch([viewedId, pane, editingPrompt, () => state.tab], () => { clearingImage.value = null })
async function clearImage(versionId: string) {
  if (busy.value || !work.value.versions.find(v => v.id === versionId)?.image) return
  operation.value = 'save'; error.value = ''
  try {
    await flushNotes()
    work.value = await window.api.pagesClearImage(work.value.id, work.value.revision, versionId)
    clearingImage.value = null
    if (!current.value.editor.regions.some(r => r.id === regionId.value)) regionId.value = null
    await refreshOverlay(); emit('updated')
  } catch (e) {
    error.value = cleanErr(e)
    try { work.value = await window.api.pagesRead(work.value.id) } catch { /* Keep current inputs if refresh fails. */ }
  } finally { operation.value = '' }
}
const operation = ref<'chat' | 'generate' | 'save' | ''>('')
const saving = ref(false), error = ref(''), progress = ref(''), zoom = ref(100), overlay = ref('')
const remoteBusy = ref(false)
let remoteLease = ''
const pendingText = ref('')
const showMask = ref(true)
const thread = ref<HTMLElement>(), dialog = ref<HTMLElement>(), viewport = ref<InstanceType<typeof ImageViewport>>()
const input = ref<HTMLTextAreaElement>()
const promptEditor = ref<InstanceType<typeof WorkspacePrompt>>()
const renaming = ref(false), nameInput = ref<HTMLInputElement>(), nameDraft = ref('')
const renameSaving = ref(false), renameButton = ref<HTMLButtonElement>()
async function startRename() { nameDraft.value=title.value; renaming.value=true; await nextTick(); nameInput.value?.focus(); nameInput.value?.select() }
async function cancelRename() { if(renameSaving.value)return;renaming.value=false;await nextTick();renameButton.value?.focus() }
async function rename() {
  if (!renaming.value || renameSaving.value) return
  const previous = title.value
  title.value=nameDraft.value.trim() || title.value; renameSaving.value=true
  try { await flushNotes();renaming.value=false;await nextTick();renameButton.value?.focus() }
  catch(e) { title.value=previous;error.value=cleanErr(e) }
  finally { renameSaving.value=false }
}
const previousFocus = document.activeElement as HTMLElement | null
let notesTimer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<unknown> = Promise.resolve()
let unsubscribe: (() => void) | undefined
let alive = true
const busy = computed(() => !!operation.value || editingPrompt.value || remoteBusy.value)
/** 本会话正在进行的生成任务，用于在执行区直接停止 */
const generateTask = computed(() => taskState.tasks.find(t => t.kind === 'page-generate' && t.targetId === work.value.id && taskIsActive(t)))
const notesValue = () => ({ type: 'notes' as const, title: title.value, goal: work.value.goal, preserve: work.value.preserve, composer: composer.value })
const savedNotes = ref(JSON.stringify(notesValue()))
const label = (id: string) => work.value.versions.find(v => v.id === id)?.label ?? '历史版本'
function shortVersion(id: string) { const v=work.value.versions.find(v=>v.id===id); if(!v)return '历史'; if(v.groupId)return v.label; const index=work.value.versions.indexOf(v); return index===0 ? (v.image?'原稿':'起点') : `版本 ${index}` }
function versionDetail(v: PageWorkspace['versions'][number]) { return [v.label,v.parentId?`来源：${label(v.parentId)}`:'',v.generated?`${v.generated.execution.kind==='inpaint'?'局部重绘':'提示词生成'} · 种子 ${v.generated.params.seed}`:''].filter(Boolean).join('\n') }
const time = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const status = (s: string) => ({ pending: '待采纳', accepted: '已采纳', rejected: '未采纳', withdrawn: '已撤销' }[s] ?? s)
function stale(m: PageMessage) { return !!m.proposal && (m.proposal.superseded || m.versionId !== current.value.id || m.proposal.contextKey !== pageContextKey(current.value, m.proposal.regionId, work.value)) }
async function setAgentMode(mode: 'internal' | 'external') {
  if (busy.value) return
  operation.value = 'save'; error.value = ''
  try { await flushNotes(); work.value = await window.api.pagesAgent(work.value.id, work.value.revision, mode, frontendContext?.actionId); savedNotes.value = JSON.stringify(notesValue()); emit('updated') }
  catch(e) { error.value = cleanErr(e) }
  finally { operation.value = ''; await scrollEnd() }
}
async function cancelExternal() {
  if (busy.value) return
  operation.value = 'save'; error.value = ''
  try { await flushNotes(); work.value = await window.api.pagesExternalCancel(work.value.id, work.value.revision, frontendContext?.actionId); emit('updated') }
  catch(e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
}
async function cancelChat() { try { await window.api.pagesCancel(work.value.id) } catch (e) { error.value = cleanErr(e) } }
function mutate(action: PageAction): Promise<void> {
  const next = chain.catch(() => {}).then(async () => {
    saving.value = true
    try { work.value = await window.api.pagesEdit(work.value.id, work.value.revision, JSON.parse(JSON.stringify(action))); emit('updated') }
    finally { saving.value = false }
  })
  // Report this mutation's error to its caller without poisoning later flushes.
  chain = next.catch(() => {})
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
async function saveEditor(editor: PageEditorState) {
  await mutate({ type: 'editor', versionId: current.value.id, editor })
}
async function beginConfig(owner: string | null = null) {
  if(busy.value || editing.value)throw new Error('请先完成当前操作')
  await flushNotes()
  configDraft.value=cloneEditor(current.value.editor);configOwner.value=owner;editingPrompt.value=true
}
async function finishConfig(discard=false) {
  if(!editingPrompt.value || !configDraft.value)return
  if(!discard) {
    const draft=cloneEditor(configDraft.value)
    if(typeof draft.params.seed==='string')draft.params.seed=null
    if(JSON.stringify(draft)!==JSON.stringify(current.value.editor))await saveEditor(draft)
  }
  editingPrompt.value=false;configDraft.value=null;configOwner.value=null
}
async function returnFromConfig() {
  operation.value='save';error.value=''
  try{await finishConfig()}catch(e){error.value=cleanErr(e)}finally{operation.value=''}
}
/** 打开选区编辑器前已有的区域；关闭时据此判断用户是否新画了区域 */
let regionsBeforeEditor = new Set<string>()
async function openEditor() {
  if (busy.value) return
  operation.value = 'save'
  try { await flushNotes(); viewedId.value = current.value.id; regionsBeforeEditor = new Set(current.value.editor.regions.map(r => r.id)); editing.value = true } catch (e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
}
async function closeEditor() {
  editing.value = false
  const regions = current.value.editor.regions
  // 只在用户刚新增了区域时自动选中它（下一条消息会附带）；
  // 原来选「不附加」又没新画区域时保持不附加，避免整图需求被悄悄当成局部需求
  const added = regions.filter(r => !regionsBeforeEditor.has(r.id))
  if (added.length) regionId.value = added[added.length - 1].id
  else if (regionId.value && !regions.some(r => r.id === regionId.value)) regionId.value = null
  overlayMode.value = 'annotation'; await refreshOverlay()
}
async function send() {
  if (busy.value || !composer.value.trim() || external.value && pendingRequest.value) return
  const discussionVersionId = discussionVersion.value.id
  error.value = ''; operation.value = 'chat'
  try {
    await flushNotes()
    const text = composer.value
    pendingText.value = text
    composer.value = ''
    await scrollEnd()
    work.value = await window.api.pagesChat(work.value.id, work.value.revision, text, regionId.value, [...references.value], frontendContext?.actionId, discussionVersionId)
    references.value = []; savedNotes.value = JSON.stringify(notesValue()); emit('updated')
  } catch (e) {
    error.value = cleanErr(e)
    try { work.value = await window.api.pagesRead(work.value.id); composer.value = work.value.composer; savedNotes.value = JSON.stringify(notesValue()) } catch { /* Preserve local state if reading also fails. */ }
  } finally { pendingText.value = ''; operation.value = ''; await scrollEnd(); input.value?.focus() }
}
async function proposal(m: PageMessage, decision: 'accept' | 'reject' | 'undo') {
  if (busy.value) return
  error.value = ''; operation.value = 'save'
  try { await flushNotes(); await mutate({ type: 'proposal', messageId: m.id, decision }); selectedProposalId.value=null; if (m.proposal?.regionId) regionId.value = m.proposal.regionId }
  catch (e) { error.value = cleanErr(e) }
  finally { operation.value = '' }
  if(decision==='accept'&&!error.value)await beginConfig(frontendContext?.agentSession ?? null)
}
async function setExecution(execution: PageExecution) {
  if(operation.value || remoteBusy.value)return
  operation.value='save';error.value=''
  try {
    if(execution.kind==='inpaint'&&configDraft.value&&(configDraft.value.params.width!==current.value.editor.params.width||configDraft.value.params.height!==current.value.editor.params.height))throw new Error('局部重绘需保持底图尺寸，请先恢复尺寸')
    await flushNotes(); await mutate({type:'execution',execution}); overlayMode.value='execution'
  }
  catch(e){error.value=cleanErr(e)} finally{operation.value=''}
}
function chooseExecution(kind: 'generate'|'inpaint') {
  void setExecution({kind,regionId:kind==='inpaint' ? work.value.execution.regionId ?? current.value.editor.regions[0]?.id ?? null : null})
}
function planLabel(e?: PageExecution, versionId = current.value.id) { return e?.kind === 'inpaint' ? '局部重绘 · '+(work.value.versions.find(v=>v.id===versionId)?.editor.regions.find(r=>r.id===e.regionId)?.label ?? '遮罩已不存在') : '按提示词生成新图' }
function review(id: string) { viewedId.value=id; pane.value='changes' }
async function showSuggestions(id: string, messageId: string | null = null) {
  selectedProposalId.value=messageId ?? pageLatestProposal(work.value,id)?.id ?? null
  await nextTick()
  if(selectedProposalId.value) document.getElementById('proposal-'+selectedProposalId.value)?.scrollIntoView({block:'nearest'})
}
function inspectMask() { overlayMode.value='execution';showMask.value=true;viewedId.value=current.value.id;pane.value='canvas' }

async function generate() {
  if (operation.value || remoteBusy.value || work.value.execution.kind==='inpaint' && !executionRegion.value) return
  error.value = ''; progress.value = '正在检查重绘参数…'; operation.value = 'generate'
  try {
    await finishConfig()
    await flushNotes()
    work.value = await window.api.pagesGenerate(work.value.id, work.value.revision, JSON.parse(JSON.stringify(work.value.execution)), frontendContext?.actionId)
    await nextTick(); viewedId.value = work.value.latestGeneratedVersionId ?? current.value.id; pane.value = 'canvas'; if(!current.value.editor.regions.some(r=>r.id===regionId.value))regionId.value=null; emit('updated')
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
  if (busy.value || editing.value || renaming.value) { error.value='请先保存或完成当前编辑，再继续操作。'; return false }
  try { await flushNotes(); return true } catch(e) { error.value=cleanErr(e); return false }
}
function desktopState() {
  const latest = pageLatestProposal(work.value, current.value.id)
  return { id: work.value.id, revision: work.value.revision, title: title.value, versionId: current.value.id,
    regionId: regionId.value, pane: editingPrompt.value ? 'config-edit' : pane.value, editing: !!operation.value || editingPrompt.value || editing.value || renaming.value, composer: composer.value,
    config: {open:editingPrompt.value,sourceVersionId:current.value.id,owner:configOwner.value,dirty:!!configDraft.value&&JSON.stringify(configDraft.value)!==JSON.stringify(current.value.editor),draft:JSON.parse(JSON.stringify(nextEditor.value.draft)),params:{...nextEditor.value.params},strength:nextEditor.value.strength,
      disabledFields:{...(configSizeLocked.value?{width:'已有遮罩或正在局部重绘',height:'已有遮罩或正在局部重绘'}:{})} },
    viewedVersionId: viewed.value.id, viewedGroupId: viewedGroup.value.id, adoptedVersionId: current.value.id, focusedProposalId: selectedProposalId.value,
    comparisonVersionId: pane.value === 'changes' ? comparison.value.source?.id ?? null : null,
    comparisonMode: compareVersionId.value ? 'specified' as const : 'source' as const, discussionVersionId: discussionContext.value.versionId,
    historyOpen: historyOpen.value, references: [...references.value], image: viewed.value.image ? { ...viewed.value.image } : null,
    regions: current.value.editor.regions.map(r => ({ id:r.id, label:r.label, instruction:r.instruction, target:r.target })),
    latestProposal: latest?.proposal ? { id:latest.id, title:latest.proposal.title, status:latest.proposal.status } : null,
    lastMessage: work.value.messages.at(-1)?.text ?? '', agentMode: work.value.agentMode ?? 'internal', agentName: agentLabel.value,
    agentConnected: agentConnected.value, agentStatus: agentStatus.value, agentActivity: agentActivity.value ? { ...agentActivity.value } : null, pendingRequestId: pendingRequest.value?.id ?? null }
}
async function frontendAction(a: import('@shared/desktop').FrontendRequest, ctx: import('@shared/desktop').FrontendContext) {
  if (operation.value || remoteBusy.value || editing.value || renaming.value || frontendContext || editingPrompt.value&&a.action!=='config') throw new Error('工作台正在编辑或执行任务，请先完成当前操作')
  if(a.action==='config'&&editingPrompt.value&&(!ctx.agentSession||configOwner.value!==ctx.agentSession))throw new Error('正在编辑的配置属于用户或其他 Agent，未覆盖修改')
  frontendContext = ctx; error.value = ''
  const check = () => { if (error.value) throw new Error(error.value); if (ctx.signal.aborted) throw new Error('已停止，已保存的内容保留') }
  const version = (id?: string) => {
    const v = work.value.versions.find(v => v.id === (id ?? current.value.id))
    if (!v) throw new Error('版本不存在')
    return v
  }
  try {
    await flushNotes(); check()
    if (a.action === 'rename') {
      await startRename(); nameDraft.value = a.title!; await ctx.step('已在项目标题处填写新名称')
      await rename(); check(); await ctx.step('项目名称已保存')
    } else if (a.action === 'delete-image') {
      if (a.confirm !== true) throw new Error('缺少删除授权')
      const v = version(a.version_id)
      if (!v.image) throw new Error('此版本没有可删除的图片')
      viewedId.value = v.id; pane.value = 'images'; await nextTick()
      clearingImage.value = v.id; await ctx.step('已定位指定候选并展示删除提示')
      await clearImage(v.id); check(); await ctx.step('图片已清理，提示词和讨论记录保留')
    } else if(a.action==='config') {
      if(a.config_action==='begin') { if(editingPrompt.value)throw new Error('配置编辑已打开');await beginConfig(ctx.agentSession!);await ctx.step('已打开下一版配置，可手动或通过 MCP 微调') }
      else {
        if(!editingPrompt.value||!configDraft.value)throw new Error('请先开始配置编辑')
        if(a.config_action==='update'){configDraft.value=patchWorkspaceConfig(configDraft.value,a.patch!,configSizeLocked.value);await ctx.step('表单已更新，尚未保存或生成')}
        else if(a.config_action==='save'){await finishConfig();await ctx.step('下一版配置已保存，已返回查看')}
        else if(a.config_action==='cancel'){await finishConfig(true);await ctx.step('已放弃本次未保存修改，返回查看')}
      }
    } else if (a.action === 'agent') {
      await ctx.step('正在切换会话处理方式'); await setAgentMode(a.mode!); check()
      await ctx.step(external.value ? '已由外部 Agent 接管，不调用内置 AI' : '已切换为内置 AI')
    } else if (a.action === 'external-cancel') {
      await cancelExternal(); check(); await ctx.step('已取消本轮外部需求，原消息和结果保留')
    } else if (a.action === 'reply') {
      await ctx.step('正在接收外部 Agent 的回复与方案')
      work.value = await window.api.pagesExternalReply(work.value.id, work.value.revision, JSON.parse(JSON.stringify(a.response)), ctx.actionId)
      savedNotes.value = JSON.stringify(notesValue()); emit('updated'); await scrollEnd()
      const message = work.value.messages.at(-1)
      if (message?.proposal) await showSuggestions(message.versionId, message.id)
      await ctx.step('外部 Agent 回复已显示，方案尚未采纳')
    } else if (a.action === 'view') {
      const v = version(a.version_id ?? viewed.value.id)
      if (a.compare_version_id !== undefined) {
        if (a.pane !== 'changes') throw new Error('对比对象仅用于修改对比面板')
        pageComparison(work.value, v.id, a.compare_version_id)
      }
      viewedId.value = v.id
      if (a.pane === 'history') { historyOpen.value = true; pane.value = 'canvas' }
      else if (a.pane !== 'suggestions') { pane.value = a.pane! }
      if (a.pane === 'changes') review(v.id)
      if (a.pane === 'suggestions') await showSuggestions(v.id)
      if (a.compare_version_id !== undefined) compareVersionId.value = a.compare_version_id
      await ctx.step('已切换工作台视图')
    } else if (a.action === 'compose') {
      if (a.region_id && !current.value.editor.regions.some(r => r.id === a.region_id)) throw new Error('区域不存在')
      for (const id of a.reference_ids ?? []) version(id)
      composer.value = a.text!; regionId.value = a.region_id ?? null; references.value = [...new Set(a.reference_ids ?? [])]
      if (regionId.value) { viewedId.value = current.value.id; pane.value = 'canvas'; overlayMode.value = 'annotation'; await refreshOverlay() }
      await flushNotes(); await ctx.step('需求已填入对话框，尚未提交')
    } else if (a.action === 'send') {
      if (!composer.value.trim()) throw new Error('对话框为空，请先填写内容')
      if (external.value && pendingRequest.value) throw new Error('已有待处理需求，请等待回复或取消后再发送')
      await ctx.step('正在提交当前对话框内容')
      await send(); check()
      if (pageLatestProposal(work.value, current.value.id)?.proposal?.status === 'pending') await showSuggestions(current.value.id)
      await ctx.step(external.value ? '需求已保存，等待外部 Agent 读取并回复' : 'AI 回复已显示，可查看建议后决定是否采纳')
    } else if (['region', 'region-update', 'region-delete'].includes(a.action)) {
      if (a.action !== 'region') {
        if (a.version_id !== current.value.id) throw new Error('区域只能修改已采用候选，请重新读取状态')
        if (!current.value.editor.regions.some(r => r.id === a.region_id)) throw new Error('区域不存在')
      }
      if (!current.value.image || current.value.image.missing) throw new Error('当前版本没有可读取的图片，无法打开选区编辑器')
      pane.value = 'canvas'
      let id: string
      try {
        await openEditor(); check(); await nextTick()
        if (!inpaintEditor.value) throw new Error('选区编辑器未打开')
        id = await inpaintEditor.value.frontendRegion(a, ctx)
      } finally { if (editing.value) await closeEditor() }
      regionId.value = a.action === 'region-delete' ? null : id; await refreshOverlay()
      await ctx.step(a.action === 'region-delete' ? '指定区域已从工作台删除' : '区域与批注已保存到工作台')
    } else if (a.action === 'review') {
      if (a.decision === 'switch') {
        const v = version(a.version_id); historyOpen.value = true; viewedId.value = v.id; pane.value = 'canvas'
        await ctx.step('已显示要继续的历史版本'); await continueVersion(v.id)
      } else {
        const m = work.value.messages.find(m => m.id === a.message_id && m.proposal)
        if (!m) throw new Error('建议不存在')
        await showSuggestions(m.versionId, m.id); await ctx.step('已在对话中展开待处理方案')
        await proposal(m, a.decision as 'accept'|'reject'|'undo')
      }
      check(); await ctx.step('处理结果已显示')
    } else if (a.action === 'generate') {
      if (a.kind === 'inpaint' && !current.value.editor.regions.some(r => r.id === a.region_id)) throw new Error('重绘区域不存在')
      await setExecution({ kind:a.kind!, regionId:a.kind === 'inpaint' ? a.region_id! : null }); check()
      inspectMask(); await refreshOverlay(); await ctx.step(a.kind === 'inpaint' ? '已显示重绘遮罩，即将执行' : '已选择整图生成，即将执行')
      await generate(); check(); historyOpen.value = true
      await ctx.step('结果已显示在画布与历史记录中')
    } else throw new Error('不支持的前台工作台操作')
  } finally { frontendContext = undefined }
}
async function beginRemote(lease: string) {
  if (busy.value || editing.value || renaming.value) throw new Error('工作台正在编辑或执行操作，请等待用户完成后重试')
  remoteLease = lease; remoteBusy.value = true
  try { await flushNotes() } catch(e) { remoteLease = ''; remoteBusy.value = false; throw e }
}
async function endRemote(lease: string) {
  if (remoteLease !== lease) return
  try {
    const oldVersion = current.value.id
    const oldGenerated = work.value.latestGeneratedVersionId
    const oldProposal = pageLatestProposal(work.value, oldVersion)?.id
    work.value = await window.api.pagesRead(work.value.id)
    title.value = work.value.title; composer.value = work.value.composer; savedNotes.value = JSON.stringify(notesValue())
    if (oldGenerated !== work.value.latestGeneratedVersionId && work.value.latestGeneratedVersionId) { viewedId.value = work.value.latestGeneratedVersionId; pane.value = 'canvas' }
    else if (oldVersion !== current.value.id) { viewedId.value = current.value.id; pane.value = 'canvas' }
    else if (!historical.value && pageLatestProposal(work.value, current.value.id)?.id !== oldProposal && pageLatestProposal(work.value, current.value.id)?.proposal?.status === 'pending') { await showSuggestions(current.value.id) }
    await refreshOverlay(); await scrollEnd(); emit('updated')
  } finally { remoteLease = ''; remoteBusy.value = false }
}
defineExpose({ prepareLeave, desktopState, beginRemote, endRemote, frontendAction })
async function close() {
  if (busy.value || editing.value) return
  try { await flushNotes(); emit('close') } catch (e) { error.value = `保存失败，窗口暂未关闭：${cleanErr(e)}` }
}
function key(e: KeyboardEvent) {
  if (editing.value || state.tab !== 'workspace' || document.querySelector('.pos-mask')) return
  if (e.key === 'Escape') { e.preventDefault(); if(historyOpen.value)historyOpen.value=false }

}
onMounted(() => { window.addEventListener('keydown', key); unsubscribe = window.api.onNaiStep('page-generate', s => { if (operation.value === 'generate') progress.value = s }); offAgents = window.api.onAgentConnections(a => { connections.value = a }); void window.api.agentConnections().then(a => { connections.value = a }).catch(() => {}); void scrollEnd() })
onBeforeUnmount(() => { alive = false; clearTimeout(notesTimer); window.removeEventListener('keydown', key); unsubscribe?.(); offAgents?.(); previousFocus?.focus() })
</script>

<template>
  <section class="pw-shell" aria-label="AI 图像创作项目" ref="dialog">
    <header class="pw-header">
      <div class="pw-header-tools">
      <b v-if="editingPrompt" class="pw-edit-title">编辑下一版配置</b>
      <div v-else class="pw-view-tabs seg"><button :class="{on:pane==='canvas'}" @click="pane='canvas'">画布</button><button :class="{on:pane==='prompt'}" @click="pane='prompt'">生图配置</button><button :class="{on:pane==='changes'}" @click="review(viewed.id)">修改对比</button><button class="pw-images-tab" :class="{on:pane==='images'}" title="本版图片" aria-label="本版图片" @click="pane='images'"><Icon name="image" :size="16"/></button></div>
        <div v-if="!editingPrompt" class="pw-header-actions">
          <button class="icon-btn sm" :aria-pressed="historyOpen" title="展开版本历史" aria-label="版本记录" @click="historyOpen=!historyOpen"><Icon name="layers" :size="17"/></button>
          <button class="icon-btn sm pw-back" :disabled="busy || editing" title="返回项目" aria-label="返回项目" @click="close"><Icon name="arrow" class="pw-back-arrow" :size="17"/></button>
        </div>
      </div>
      <div class="pw-heading">
        <form v-if="renaming" class="pw-name-form" @submit.prevent="rename" @keydown.esc.stop.prevent="cancelRename">
          <input ref="nameInput" v-model="nameDraft" class="pw-name-input" :disabled="renameSaving" maxlength="100" aria-label="项目名称" @keydown.enter.prevent="!$event.isComposing&&rename()">
          <button type="submit" class="icon-btn sm pw-name-save" :disabled="renameSaving" title="保存名称（Enter）" aria-label="保存项目名称"><Icon name="check" :size="14"/></button>
          <button type="button" class="icon-btn sm" :disabled="renameSaving" title="取消（Esc）" aria-label="取消重命名" @click="cancelRename"><Icon name="x" :size="14"/></button>
        </form>
        <button v-else ref="renameButton" class="pw-rename" :disabled="busy" :title="title+' · 重命名项目'" @click="startRename"><b>{{ title }}</b><Icon name="edit" :size="14" /></button>
      </div>

    </header>
    <div class="pw-main">
      <aside v-if="historyOpen && !editingPrompt" class="pw-history scroll" aria-label="配置版本">
        <button v-for="group in groupCards" :key="group.id" class="pw-version" :disabled="editingPrompt" :class="{selected:viewedGroup.id===group.id}" @click="viewedId=group.cover.id">
          <img v-if="group.cover.image && !group.cover.image.missing" :src="group.cover.image.url" @error="group.cover.image.missing=true" alt="" loading="lazy"><div v-else class="pw-version-empty"><Icon name="chat"/></div>
          <div><b>{{ group.label.replace('方案 ', '版本 ') }}</b><span v-if="group.adopted" class="pw-current">当前蓝本</span><small>{{ group.versions.filter(v=>v.image).length }} 张图片</small></div>
        </button>
      </aside>
      <div class="pw-canvas-column">

        <div v-if="editingPrompt" class="pw-scope-bar"><span class="muted small">基于 {{ current.label }}</span><span class="muted small ml-auto">返回时保存</span></div>
        <div v-else class="pw-scope-bar" :data-historical="historical">
          <div class="pw-scope-label" :title="viewed.label"><b>{{ viewedGroup.label.replace('方案 ', '版本 ') }}</b><span class="muted small">第 {{ viewedGroup.versions.findIndex(v=>v.id===viewed.id)+1 }} 张</span></div>
          <div class="pw-scope-actions">
            <button class="icon-btn sm" title="引用此版参与讨论" aria-label="引用此版" :disabled="busy || !viewed.image" @click="reference(viewed.id)"><Icon name="chat" :size="15"/></button>
            <button class="btn small pw-adopt" :class="{ghost:!historical}" :disabled="busy || !historical || viewed.image?.missing" :title="historical ? '设为创作蓝本，从这张图片继续修改和重绘' : '下一版配置与重绘基于这张图片'" @click="continueVersion(viewed.id)">{{ historical ? '设为蓝本' : '当前蓝本' }}</button>
            <button v-if="pane==='canvas'&&viewed.image" class="btn ghost small" @click="viewport?.reset()">{{ zoom }}% · 适应画布</button>
            <ThemeSelect v-if="pane==='changes'" v-model="compareVersionId" class="pw-compare" :options="compareOptions" aria-label="对比对象" />
          </div>
          <div v-if="pane==='prompt'" class="pw-prompt-actions">
            <button class="icon-btn sm" title="复制完整提示词" @click="promptEditor?.copyPrompt()"><Icon name="copy" :size="15"/></button>
          </div>
        </div>
        <WorkspacePrompt v-if="editingPrompt && configDraft" ref="promptEditor" :editor="configDraft" :model="configDraft.model ?? work.model" :image="current.image" editable :disabled="!!operation || remoteBusy" :size-locked="configSizeLocked" @input.capture="configOwner=null" @change.capture="configOwner=null" @click.capture="configOwner=null" />
        <template v-else-if="pane==='canvas'">
          <ImageViewport v-if="viewed.image && !viewed.image.missing" ref="viewport" class="pw-viewport" :width="viewed.image.width||1" :height="viewed.image.height||1" v-model:zoom="zoom" label="创作画布"><img :src="viewed.image.url" @error="viewed.image.missing=true" :alt="viewed.label" draggable="false"><img v-if="overlay && showMask && !historical" class="pw-overlay" :src="overlay" alt="区域标记" draggable="false"></ImageViewport>
          <div v-else class="pw-blank"><Icon name="image" :size="40"/><span>{{ viewed.imageCleared ? '图片已清理，提示词和生成参数仍保留' : viewed.image?.missing ? '图片文件缺失，生成记录仍保留' : '暂无图片' }}</span><button v-if="viewed.image?.missing" class="btn small" :disabled="busy" @click="recoverImage">恢复原图</button></div>
<div class="pw-canvas-actions"><button class="btn accent small" :disabled="busy || historical || !current.image || current.image.missing" @click="openEditor"><Icon name="edit" :size="14"/>区域批注 / 遮罩</button><button v-if="overlay&&!historical" class="btn ghost small" @click="showMask=!showMask">{{ showMask?'隐藏标记':'显示标记' }}</button><span v-if="displayRegion&&!historical" class="muted small">{{ overlayMode==='execution'?'执行遮罩':'说明区域' }} {{ displayRegion.label }}</span></div>


        </template>
        <div v-else-if="pane==='images'" class="pw-candidates scroll" aria-label="本版本图片预览">
          <article v-for="v in viewedCandidates" :key="v.id" class="pw-candidate" :class="{selected:v.id===viewed.id}" :data-version-id="v.id">
            <button class="pw-candidate-open" :aria-pressed="v.id===viewed.id" :disabled="busy" @click="viewedId=v.id;pane='canvas'">
            <div class="pw-candidate-image"><img v-if="v.image&&!v.image.missing" :src="v.image.url" :alt="v.label" loading="lazy" @error="v.image.missing=true"><span v-else class="muted">{{ v.imageCleared ? '图片已清理' : v.image ? '图片缺失' : '暂无图片' }}</span></div>
            <div class="pw-candidate-caption"><b>第 {{ viewedGroup.versions.findIndex(candidate=>candidate.id===v.id)+1 }} 张</b><span v-if="v.id===current.id" class="pw-current">当前蓝本</span><span v-else-if="v.id===viewed.id" class="muted">查看中</span></div>
            </button>
            <button v-if="v.image && clearingImage!==v.id" class="icon-btn sm pw-candidate-delete" :disabled="busy" title="删除这张图片" :aria-label="`删除图片：${v.label}`" @click.stop="clearingImage=v.id"><Icon name="trash" :size="14"/></button>
            <div v-if="clearingImage===v.id" class="pw-candidate-delete-confirm" role="alertdialog" :aria-label="`确认删除图片：${v.label}`" @click.stop @keydown.esc.stop="clearingImage=null">
              <b>删除这张图片？</b><span>提示词和版本记录保留。</span>
              <div class="row"><button class="btn ghost small" :disabled="busy" @click="clearingImage=null">取消</button><button class="btn primary small" :disabled="busy" @click="clearImage(v.id)">{{ operation==='save' ? '删除中…' : '确认删除' }}</button></div>
            </div>
          </article>
          <div v-if="!viewedCandidates.length" class="pw-candidates-empty muted">本版图片已清理，提示词和版本记录仍可查看。</div>
        </div>
        <template v-else-if="pane==='prompt'"><WorkspacePrompt v-if="snapshotEditor" ref="promptEditor" :key="viewed.id" :editor="snapshotEditor" :model="snapshotEditor.model ?? work.model" :image="viewed.image" /><div v-else class="pw-blank">此版本未保存生图配置快照</div></template>
        <div v-else-if="pane==='changes'" class="pw-change-board scroll">
          <WorkspaceIterations :work="work" :version-id="viewed.id" :compare-id="compareVersionId"/>

        </div>
        <div class="pw-execution" aria-label="下一次生成" :title="'基于 '+current.label+' 的下一版配置'">
          <ThemeSelect :model-value="work.execution.kind==='generate' ? 'generate' : work.execution.regionId" :disabled="!!operation || remoteBusy" :options="[{value:'generate',label:'按提示词生图'},...current.editor.regions.map(r=>({value:r.id,label:'局部重绘 · '+r.label,disabled:!current.image||current.image.missing}))]" aria-label="生成方式" @update:model-value="id=>setExecution(id==='generate'?{kind:'generate',regionId:null}:{kind:'inpaint',regionId:id})" />
          <span class="muted small pw-execution-summary">{{ nextEditor.params.width }}×{{ nextEditor.params.height }} · {{ nextEditor.params.steps }} 步</span>
          <div class="pw-generation-actions">
            <button v-if="editingPrompt" class="btn pw-config-back" :disabled="!!operation || remoteBusy" @click="returnFromConfig"><Icon name="arrow" class="pw-back-arrow" :size="16"/>返回查看</button>
            <button v-else class="btn pw-config-edit" :disabled="busy" @click="beginConfig().catch(e=>error=cleanErr(e))"><Icon name="sliders" :size="16"/>编辑配置</button>
            <button class="btn accent pw-generate" :disabled="!!operation || remoteBusy || !nextEditor.draft.base.trim()&&!nextEditor.draft.characters.some(c=>c.prompt.trim()) || work.execution.kind==='inpaint'&&!executionRegion" @click="generate"><Icon name="wand" :size="16"/>{{ operation==='generate'?'生成中…':work.execution.kind==='generate'?'生成图片':'执行重绘' }}<span v-if="operation!=='generate'&&nextEditor.params.count>1" class="pw-generation-count">{{ nextEditor.params.count }}</span></button>
          </div>
          <div v-if="operation==='generate'" class="row pw-run-progress" role="status"><Icon name="paw" :size="13" class="spin-slow"/><span class="muted small grow">{{ progress || '正在执行…' }}</span><button v-if="generateTask" class="btn small ghost" :disabled="generateTask.status==='cancelling'" @click="cancelTask(generateTask.id)">{{ generateTask.status==='cancelling' ? '完成后停止' : '停止' }}</button></div>
        </div>
      </div>
      <aside class="pw-conversation"><div class="pw-thread-header"><div><Icon name="sparkle" :size="17"/><b>对话</b></div><span :title="agentLabel">{{ agentLabel }}</span></div><div class="pw-agent-mode"><ThemeSelect :model-value="work.agentMode ?? 'internal'" :disabled="busy" :options="[{value:'internal',label:'内置 AI'},{value:'external',label:'外部 Agent 接管'}]" aria-label="会话处理方式" @update:model-value="setAgentMode"/><span v-if="external" :class="{connected:agentConnected}">{{ agentStatus }}</span></div><div class="pw-context"><span class="pw-context-dot"></span>当前蓝本 <b>{{ current.label }}</b><button v-if="historical" :disabled="busy" @click="viewedId=current.id">回到当前</button></div>
        <div class="pw-thread scroll" ref="thread" aria-live="polite"><div v-if="!work.messages.some(m=>m.role==='user')&&!pendingText" class="pw-welcome"><p>描述想生成或修改的内容</p></div>
          <div v-for="m in work.messages" :key="m.id" :class="['pw-message',m.role,{failed:m.error}]"><template v-if="m.role==='event'"><span>{{ m.text }}</span></template><template v-else><div class="pw-message-meta"><b>{{ m.role==='user'?'你':m.author?.name || 'AI' }}</b><button :disabled="editingPrompt" @click="viewedId=m.versionId;pane='canvas'">{{ label(m.versionId) }}</button><time>{{ time(m.createdAt) }}</time></div><MarkdownText v-if="m.role==='assistant'" :text="m.text"/><div v-else class="pw-message-text">{{ m.text }}</div><div v-if="m.discussion && m.discussion.versionId !== m.versionId" class="pw-citations"><button :disabled="editingPrompt" @click="viewedId=m.discussion.versionId;pane='canvas'">讨论 {{ m.discussion.label }}</button><span>建议修改 {{ label(m.versionId) }}</span></div><div v-if="m.referenceIds?.length" class="pw-citations"><button v-for="id in m.referenceIds" :key="id" :disabled="editingPrompt" @click="viewedId=id;pane='canvas'">引用 {{ label(id) }}</button></div><details v-if="m.proposal" class="pw-proposal" :id="`proposal-${m.id}`" :open="selectedProposalId===m.id || m.proposal.status==='pending'&&!m.proposal.superseded"><summary><b>{{ m.proposal.title }}</b><span class="pill">{{ status(m.proposal.status) }}</span></summary><div class="pw-proposal-body"><p class="pw-plan-kind">建议执行：{{ planLabel(m.proposal!.execution,m.versionId) }}</p><p v-if="m.proposal!.warning" class="pw-warning">{{ m.proposal!.warning }}</p><div v-for="(c,i) in m.proposal!.changes" :key="i" class="pw-change"><label>{{ changeLabel(c) }}</label><DiffChips :diff="diffPrompt(c.before,c.after)"/><p v-if="c.reason">{{ c.reason }}</p><details v-if="c.before||c.after"><summary>完整修改前后</summary><pre>{{ c.before||'（空）' }}</pre><pre>{{ c.after||'（空）' }}</pre></details></div><p v-if="!m.proposal!.changes.length" class="muted small">保持当前提示词，使用上述执行方式继续尝试。</p><p v-if="m.proposal!.status==='pending'&&stale(m)" class="muted small">上下文或执行设置已改变，请基于当前状态重新提出方案。</p><div v-if="m.proposal!.status==='pending'" class="row"><button class="btn small primary" :disabled="busy||stale(m)" @click="proposal(m,'accept')">采纳方案</button><button class="btn ghost small" :disabled="busy" @click="proposal(m,'reject')">不采用</button></div><button v-if="m.proposal!.status==='accepted'" class="btn ghost small" :disabled="busy||m.versionId!==current.id" @click="proposal(m,'undo')">撤销采纳</button></div></details><details v-if="m.skills" class="pw-used-skills"><summary>本轮 Skill · {{ m.skills.length }}</summary>{{ m.skills.join('、') || '未启用 Skill' }}</details></template></div>
          <div v-if="pendingRequest" class="pw-external-wait" role="status"><span>{{ agentActivity ? agentActivity.message || 'Agent 正在处理本轮需求' : agentConnected ? '需求已保存，等待 Agent 开始处理' : '需求已保存，等待重新接管' }}</span><small>{{ agentActivity ? '处理状态由 Agent 报告；长时间没有更新会回到等待状态。' : '连接不会自动启动处理。复制接续指令到 Agent 对话中继续。' }}</small><button class="btn ghost small" @click="copy(`请继续处理 NovelPrompt 项目 ${work.id}（${work.title}）的待处理需求。先读取 get_workspace_context；如连接已更换，请重新接管后处理，不要重复提交需求。`)">复制接续指令</button><button class="btn ghost small" :disabled="busy" @click="cancelExternal">取消本轮需求</button></div><div v-if="pendingText" class="pw-message user"><div class="pw-message-text">{{ pendingText }}</div></div><div v-if="operation==='chat'" class="pw-thinking"><Icon name="sparkle" :size="16" class="spin-slow"/>正在分析上下文…<button @click="cancelChat">停止</button></div><div v-if="operation==='generate'" class="pw-thinking">{{ progress }}</div>
        </div>
        <div class="pw-compose">
          <div class="pw-discussion-context" aria-label="本轮讨论对象">
            <span>{{ pendingRequest ? '已提交讨论' : '本轮讨论' }} <b>{{ discussionContext.label }}</b></span>
            <span v-if="discussionContext.versionId !== discussionContext.editVersionId">建议修改 <b>{{ discussionContext.editLabel }}</b>；要修改这张图，请先设为蓝本</span>
          </div>
          <div v-if="error" class="pw-error" role="alert">{{ error }}<button @click="error=''">×</button></div><div v-if="references.length" class="pw-reference-chips"><button v-for="id in references" :key="id" :disabled="busy" @click="reference(id)">引用 {{ label(id) }} ×</button></div><div v-if="current.editor.regions.length" class="pw-target"><ThemeSelect v-model="regionId" :options="regionOptions" :disabled="busy" aria-label="附加区域批注" @update:model-value="overlayMode='annotation'"/></div><div class="pw-input-wrap"><textarea v-autosize ref="input" v-model="composer" :disabled="busy" maxlength="6000" aria-label="持续讨论输入" placeholder="描述目标，或接着上次的结果继续说…" @keydown.enter.exact.prevent="!$event.isComposing&&send()"></textarea><button class="pw-send" :disabled="busy||!composer.trim()||external&&!!pendingRequest" :title="external ? '保存需求，等待外部 Agent 回复' : '发送'" @click="send"><Icon name="arrow" :size="18"/></button></div></div>
      </aside>
    </div>

    <InpaintEditor ref="inpaintEditor" v-if="editing&&current.image" :image="current.image" :params="current.editor.params" :initial-editor="current.editor" :initial-model="work.model" :initial-region-id="regionId" :save-editor="saveEditor" selection-only @close="closeEditor"/>
  </section>
</template>

<style scoped>
.pw-proposal>summary{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px}.pw-proposal>summary .pill{margin-left:auto;flex-shrink:0}.pw-proposal-body{margin-top:10px}
.pw-header .pw-view-tabs{flex-shrink:0}.pw-header .pw-back{margin-left:auto;flex-shrink:0}.pw-header .pw-heading{flex:0 1 260px;min-width:60px}.pw-header .pw-rename b{font-size:12px}.pw-header>.btn:last-child{flex-shrink:0}.pw-scope-bar{min-height:52px}.pw-prompt-actions{flex-shrink:0}

.pw-scope-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0 14px;flex-shrink:0}.pw-scope-bar>b{font-size:13px}.pw-scope-bar :deep(.theme-select){min-width:140px;max-width:240px}
.pw-discussion-context{display:flex;flex-direction:column;gap:3px;margin-bottom:8px;font-size:10px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.pw-discussion-context b{font-weight:500;color:var(--text2)}
.pw-agent-mode{display:flex;align-items:center;gap:10px;padding:8px 20px;font-size:11px;color:var(--muted)}.pw-agent-mode :deep(.theme-select){flex:1;min-width:0}.pw-agent-mode .connected{color:var(--pink-deep)}.pw-external-wait{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;border:1px solid var(--pink-line);border-radius:12px;background:var(--pink-soft);font-size:12px}.pw-external-wait small{color:var(--muted)}



.pw-view-tabs{max-width:100%;overflow-x:auto}

.pw-shell{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bg);outline:none}
.pw-header{height:46px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:6px 18px;border-bottom:1px solid var(--line)}
.pw-heading{min-width:0;flex:1}.pw-rename{display:flex;align-items:center;gap:8px;max-width:100%;padding:5px 8px;border:1px solid transparent;border-radius:8px;text-align:left}.pw-rename b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pw-rename .icon{flex-shrink:0;color:var(--muted)}.pw-rename:hover,.pw-rename:focus-visible{background:var(--hover);border-color:var(--line2)}.pw-heading input{width:100%;max-width:360px}
.pw-notes{padding:16px 24px;background:var(--panel);border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;flex-shrink:0}.pw-notes label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text2)}.pw-notes textarea{height:64px;min-height:64px;resize:none}.pw-notes p{grid-column:1/-1;margin:0;font-size:11px;color:var(--muted)}
.pw-main{display:flex;flex:1;min-height:0}.pw-history{width:172px;flex-shrink:0;background:var(--side);padding:16px 12px;border-right:1px solid var(--line)}.pw-section-title{font-size:12px;font-weight:650;margin:0 0 12px}.pw-section-title span{color:var(--muted);font-size:10px;font-weight:400;margin-left:6px}.pw-version{width:100%;text-align:left;padding:7px;border:1px solid transparent;border-radius:12px;margin-bottom:10px}.pw-version:hover{background:var(--hover)}.pw-version.selected{border-color:var(--pink-line);background:var(--pink-soft)}.pw-version img{width:100%;height:98px;object-fit:contain;border-radius:6px;background:var(--bg)}.pw-version div{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:6px}.pw-version b{font-size:12px}.pw-version small{width:100%;font-size:10px;color:var(--muted)}.pw-current{font-size:9px;color:var(--pink-deep);margin-left:auto}
.pw-canvas-column{flex:1;min-width:240px;display:flex;flex-direction:column;background:var(--panel);padding:0 18px}.pw-canvas-bar{display:flex;justify-content:space-between;align-items:center;height:54px;flex-shrink:0}.pw-canvas-bar>div{display:flex;gap:12px;align-items:center}.pw-canvas-bar b{font-size:13px}.pw-viewport{flex:1;min-height:120px;border:1px solid var(--line2);border-radius:12px;background:var(--side)}.pw-overlay{opacity:.32;pointer-events:none}.pw-canvas-actions{display:flex;gap:10px;align-items:center;padding:15px 0;flex-shrink:0}.pw-regions{display:flex;gap:6px;padding-bottom:15px;flex-wrap:wrap}.pw-regions button{font-size:11px;padding:5px 11px;background:var(--bg);border:1px solid var(--line2);border-radius:20px}.pw-regions .on{background:var(--pink-soft);border-color:var(--pink-line);color:var(--pink-deep)}.pw-regions i{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--ok);margin-left:5px}
.pw-conversation{width:380px;min-width:310px;max-width:46%;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--bg)}.pw-thread-header{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;flex-shrink:0}.pw-thread-header>div{display:flex;gap:8px;align-items:center;font-size:14px}.pw-thread-header .icon{color:var(--pink)}.pw-thread-header>span{display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 0 auto;font-size:11px;color:var(--muted)}.pw-context{display:flex;align-items:center;gap:7px;margin:0 20px 12px;padding:9px 11px;border-radius:9px;background:var(--panel);font-size:11px;color:var(--text2);flex-shrink:0}.pw-context b{color:var(--text)}.pw-context button{margin-left:auto;color:var(--pink-deep);font-size:10px}.pw-context-dot{width:6px;height:6px;background:var(--pink);border-radius:50%}.pw-thread{flex:1;min-height:0;padding:6px 20px 20px;scroll-behavior:smooth}.pw-welcome{padding:28px 2px 12px}.pw-welcome-icon{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:17px;background:var(--pink-soft);color:var(--pink);margin-bottom:16px}.pw-welcome h2{font-size:19px}.pw-welcome p{font-size:12px;color:var(--text2);line-height:1.9;margin:12px 0 20px}.pw-welcome>button{display:flex;align-items:center;justify-content:space-between;text-align:left;gap:10px;width:100%;padding:12px 14px;margin:8px 0;font-size:12px;border:1px solid var(--line2);border-radius:12px;line-height:1.6}.pw-welcome>button:hover{border-color:var(--pink-line);background:var(--pink-soft)}
.pw-message{margin:16px 0;font-size:12px;line-height:1.8}.pw-message-meta{display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:10px;color:var(--muted)}.pw-message-meta b{color:var(--text2);font-size:11px}.pw-message-meta button{font-size:10px;background:var(--panel);border-radius:5px;padding:0 5px}.pw-message-meta time{margin-left:auto}.pw-message-text{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.pw-message.user .pw-message-text{background:var(--pink-soft);border-radius:12px 3px 12px 12px;padding:11px 14px}.pw-message.event{font-size:10px;color:var(--muted);border-left:2px solid var(--line2);padding-left:10px}.pw-message.event.failed{color:var(--bad)}.pw-proposal{border:1px solid var(--pink-line);border-radius:12px;padding:13px;margin-top:12px;background:var(--bg)}.pw-proposal>.row>b{font-size:12px}.pw-proposal .pill{font-size:9px}.pw-warning{color:var(--alias);font-size:11px;white-space:pre-wrap}.pw-change{border-top:1px solid var(--line);padding:12px 0}.pw-change label{font-weight:600;font-size:11px}.pw-change p{font-size:11px;color:var(--text2);margin:8px 0 0}.pw-change details{font-size:10px;color:var(--muted);margin-top:8px}.pw-change summary{cursor:pointer}.pw-change pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:var(--panel);padding:8px;border-radius:8px;font:10px/1.7 var(--mono);user-select:text}.pw-citations{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.pw-citations button{font-size:10px;color:var(--pink-deep);display:flex;align-items:center;gap:4px}.pw-thinking{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--text2);padding:15px 0}.pw-thinking button{color:var(--pink-deep);margin-left:auto;flex-shrink:0}
.pw-compose{padding:12px 16px 16px;border-top:1px solid var(--line);flex-shrink:0;background:var(--bg)}.pw-target{display:flex;gap:8px;align-items:center;margin-bottom:10px}.pw-target>:first-child{flex:1;min-width:0}.pw-input-wrap{border:1px solid var(--line2);border-radius:14px;padding:10px 10px 8px;background:var(--panel);display:flex;align-items:flex-end;gap:8px}.pw-input-wrap:focus-within{border-color:var(--pink-line);box-shadow:0 0 0 3px var(--pink-soft)}.pw-input-wrap textarea{border:0;outline:none;box-shadow:none;background:transparent;resize:none;min-height:50px;max-height:180px;flex:1;min-width:0;font-size:12px;line-height:1.8}.pw-send{width:32px;height:32px;border-radius:11px;background:var(--pink);color:white;display:grid;place-items:center;flex-shrink:0}.pw-send:disabled{opacity:.4}.pw-compose-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;min-height:30px}.pw-compose-foot>span{font-size:10px;color:var(--muted)}.pw-reference-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.pw-reference-chips button{font-size:10px;padding:5px 8px;border-radius:7px;background:var(--pink-soft);color:var(--pink-deep);display:flex;gap:5px;align-items:center}.pw-error{font-size:11px;background:var(--bad-soft);color:var(--bad);padding:8px 10px;border-radius:8px;margin-bottom:10px;white-space:pre-wrap;overflow-wrap:anywhere;display:flex;justify-content:space-between;gap:10px}.pw-error button{flex-shrink:0}
@media(max-width:1050px){.pw-conversation{width:370px;min-width:320px;max-width:48%}.pw-history{width:130px}.pw-canvas-column{padding:0 12px}.pw-header{padding:6px 12px;gap:8px}.pw-canvas-actions>.muted{display:none}}
@media(max-width:800px){.pw-history{position:absolute;left:0;top:46px;bottom:0;z-index:4;box-shadow:var(--shadow);width:170px}.pw-conversation{width:340px;max-width:52%;min-width:280px}.pw-header>.pill{display:none}.pw-header .btn{font-size:11px}.pw-thread{padding:6px 12px 15px}.pw-notes{padding:12px}}
.pw-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;min-height:52px;padding:8px 0;flex-wrap:wrap}.pw-view-tabs{margin:0;flex-shrink:0}.pw-prompt-actions{display:flex;align-items:center;gap:6px;margin-left:auto}.pw-execution>.row:last-child{margin-top:10px}.pw-execution{padding:14px 0;border-top:1px solid var(--line);flex-shrink:0}.pw-execution>.row{gap:10px;flex-wrap:wrap}.pw-execution>.row+.row{margin-top:8px}.pw-execution b{font-size:12px}.pw-execution p{font-size:11px;color:var(--text2);line-height:1.7;margin:8px 0}.pw-execution :deep(.theme-select){min-width:160px;flex:1}.pw-blank{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);gap:15px;text-align:center;padding:20px}.pw-blank p{font-size:12px;line-height:1.8}.pw-change-board{flex:1;min-height:0;padding:16px 0}.pw-change-board>h3{font-size:14px}.pw-change-board>.pw-proposal{margin:15px 0}.pw-plan-kind{font-size:12px;color:var(--pink-deep)}.pw-empty-plan{margin:50px 10px;color:var(--muted);font-size:13px}.pw-locator-help{font-size:10px;color:var(--muted);margin:0 0 12px}.pw-understanding{padding:14px 24px;background:var(--panel);border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;max-height:180px;overflow:auto;flex-shrink:0}.pw-understanding p{white-space:pre-wrap;line-height:1.7;margin:5px 0}.pw-understanding>span{grid-column:1/-1;color:var(--muted);font-size:11px}.pw-used-skills{font-size:10px;color:var(--muted);margin-top:8px}.pw-version-empty{height:70px;display:grid;place-items:center;color:var(--pink)}.pw-historical-prompt{max-height:160px;font-size:11px;margin-bottom:10px;flex-shrink:0}.pw-historical-prompt pre,.pw-change-board pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.pw-history{max-width:18%}
.pw-change>label{display:block;margin-bottom:8px}.pw-change :deep(.diff-row){padding:0;margin:0 0 10px}.pw-change :deep(.diff-prose){margin:10px 0}.pw-version b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pw-current{flex-shrink:0}.pw-version>div{min-width:0}
.pw-candidates{position:relative;flex-shrink:0;margin-bottom:8px}.pw-candidate-list{position:absolute;top:100%;left:0;right:0;z-index:20;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px #0002;display:flex;gap:8px;overflow:auto;max-height:145px;padding:8px 4px;scrollbar-gutter:stable}.pw-candidate-list button{flex-shrink:0;display:flex;flex-direction:column;gap:5px;width:94px;padding:6px;border:1px solid var(--line);border-radius:10px;font-size:10px}.pw-candidate-list button.selected{border-color:var(--pink);background:var(--pink-soft)}.pw-candidate-list img,.pw-candidate-missing{height:74px;width:80px;object-fit:contain}.pw-candidate-missing{display:grid;place-items:center;color:var(--muted)}
.pw-scope-bar{height:52px;min-height:52px;flex-wrap:nowrap;padding:8px 0;gap:8px}.pw-scope-label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;white-space:nowrap;overflow:hidden}.pw-scope-label b{font-size:13px}.pw-scope-label span{overflow:hidden;text-overflow:ellipsis}.pw-scope-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}.pw-adopt{min-width:70px}.pw-scope-bar .pw-prompt-actions{margin-left:0}.pw-images-tab{display:flex;align-items:center;justify-content:center}.pw-canvas-actions{height:48px;padding:8px 0}.pw-execution{height:112px;min-height:112px;position:relative;padding:12px 0}.pw-execution>.row{flex-wrap:nowrap;min-height:34px}.pw-execution b{white-space:nowrap}.pw-execution :deep(.theme-select){min-width:0}.pw-execution-bottom>.btn{flex-shrink:0;white-space:nowrap}.pw-run-progress{position:absolute;inset:0;background:var(--panel);padding:14px 0;z-index:1}.pw-candidates{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(180px,100%),1fr));align-content:start;gap:14px;padding:12px 0 20px}.pw-candidate{min-width:0;padding:8px;text-align:left;border:1px solid var(--line);border-radius:14px;background:var(--bg)}.pw-candidate:hover,.pw-candidate.selected{border-color:var(--pink-line);background:var(--pink-soft)}.pw-candidate-image{height:220px;display:grid;place-items:center;border-radius:9px;overflow:hidden;background:var(--panel)}.pw-candidate-image img{width:100%;height:100%;object-fit:contain}.pw-candidate-caption{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 4px 2px;font-size:12px}.pw-candidate-caption span{font-size:11px}
.pw-edit-title{font-size:14px}.pw-scope-bar{display:flex}.pw-scope-actions .pw-compare{width:180px;max-width:220px}.pw-execution{display:flex;align-items:center;gap:10px;height:64px;min-height:64px;padding:10px 0}.pw-execution :deep(.theme-select){flex:0 1 auto;max-width:210px;width:auto;min-width:0}.pw-execution>.btn{flex-shrink:0;white-space:nowrap}.pw-execution-summary{white-space:nowrap}.pw-change-board{padding:8px 0}.pw-run-progress{margin:0!important}.pw-scope-actions{min-width:0}.pw-scope-label{flex-shrink:1}.pw-compare :deep(.theme-select-trigger){overflow:hidden;text-overflow:ellipsis}
@media(max-width:1250px){.pw-execution-summary{display:none}.pw-execution{gap:6px}.pw-execution>.btn{padding-left:10px;padding-right:10px}.pw-scope-actions .pw-compare{width:140px}.pw-scope-actions{gap:3px}}
.pw-shell{--pw-chat-width:380px}
.pw-candidate{position:relative}.pw-candidate-open{display:block;width:100%;padding:0;text-align:left;border-radius:9px}.pw-candidate-open:disabled{cursor:default}.pw-candidate-delete{position:absolute;top:14px;right:14px;background:var(--bg);box-shadow:var(--shadow-sm);opacity:0;pointer-events:none;transition:opacity .15s,color .15s}.pw-candidate:hover .pw-candidate-delete,.pw-candidate:focus-within .pw-candidate-delete{opacity:1;pointer-events:auto}.pw-candidate-delete:hover{color:var(--bad)}.pw-candidate-delete-confirm{position:absolute;left:8px;right:8px;bottom:8px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);box-shadow:var(--shadow-sm);font-size:12px;line-height:1.7}.pw-candidate-delete-confirm>span{display:block;color:var(--muted)}.pw-candidate-delete-confirm .row{justify-content:flex-end;gap:6px;margin-top:8px}.pw-candidates-empty{grid-column:1/-1;text-align:center;padding:40px 12px;font-size:12px}@media(hover:none){.pw-candidate-delete{opacity:1;pointer-events:auto}}
.pw-header{padding:0;gap:0;display:grid;grid-template-columns:minmax(0,1fr) var(--pw-chat-width)}
.pw-header-tools{display:flex;align-items:center;gap:12px;min-width:0;padding:0 18px;height:100%}
.pw-header-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex-shrink:0}
.pw-header-actions .icon-btn{width:30px;height:30px;border-radius:9px}
.pw-header-actions [aria-pressed=true]{background:var(--pink-soft);color:var(--pink-deep)}
.pw-back-arrow{transform:rotate(180deg)}
.pw-header .pw-heading{width:100%;min-width:0;height:100%;padding:0 20px;border-left:1px solid var(--line);display:flex;align-items:center}
.pw-heading .pw-rename{width:100%;min-width:0;padding:5px 0;gap:8px;border:0;border-radius:0;background:transparent}
.pw-heading .pw-rename:hover,.pw-heading .pw-rename:focus-visible{background:transparent}
.pw-heading .pw-rename b{min-width:0;flex:0 1 auto;text-align:left;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
.pw-heading .pw-rename .icon{opacity:0;transition:opacity .15s,color .15s}.pw-heading .pw-rename:hover .icon,.pw-heading .pw-rename:focus-visible .icon{opacity:1;color:var(--text2)}
.pw-name-form{display:flex;align-items:center;gap:3px;width:100%;min-width:0;height:32px;padding:3px 4px 3px 10px;border:1px solid var(--pink-line);border-radius:9px;background:var(--bg);box-shadow:0 0 0 3px var(--pink-soft)}
.pw-name-form .pw-name-input{flex:1;min-width:0;width:0;padding:0;border:0;background:transparent;outline:none;font-size:12px;font-weight:600}.pw-name-form .icon-btn{flex-shrink:0;width:24px;height:24px}.pw-name-save{color:var(--pink-deep)}
.pw-heading input{max-width:none}
.pw-conversation{width:var(--pw-chat-width);min-width:var(--pw-chat-width);max-width:none;flex:0 0 var(--pw-chat-width)}
.pw-generation-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}
.pw-generation-count{font-size:11px;border-left:1px solid #ffffff60;padding-left:7px}
.pw-execution :deep(.theme-select){height:36px;min-height:36px;border-radius:11px;font-size:12px;padding:0 12px;box-shadow:none}
@media(max-width:1050px){.pw-shell{--pw-chat-width:320px}.pw-header-tools{padding:0 12px;gap:6px}.pw-header .pw-heading{padding:0 16px}}
@media(max-width:800px){.pw-shell{--pw-chat-width:280px}.pw-header-actions{gap:2px}.pw-generation-actions{gap:6px}.pw-generation-actions .btn{padding:0 10px}.pw-header-tools{gap:4px}}
</style>
