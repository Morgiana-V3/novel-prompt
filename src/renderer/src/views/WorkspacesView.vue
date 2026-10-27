<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { DesktopState, FrontendRequest, FrontendContext } from '@shared/desktop'
import type { PageWorkspace as Session, PageWorkspaceSummary } from '@shared/page-workspace'
import type { NaiImage, NaiGenParams } from '@shared/types'
import { state, cleanErr, toast, loadGenParams } from '../store'
import PageWorkspace from '../components/PageWorkspace.vue'
import Icon from '../components/Icon.vue'
import ThemeSelect from '../components/ThemeSelect.vue'

const sessions = ref<PageWorkspaceSummary[]>([]), current = ref<Session | null>(null)
const creating = ref(false), busy = ref(false), error = ref(''), deleting = ref<string | null>(null)
const start = ref('blank'), title = ref(''), selectedImage = ref<NaiImage | null>(null)
const projectDialog = ref<HTMLDialogElement>()
const frontendControl = inject<{ state: Ref<DesktopState['frontend']>; stop: () => void }>('frontend-control')
const frontendRunning = computed(() => frontendControl?.state.value?.status === 'running')
const modalOpen = () => creating.value
function dismissDialog() { if (frontendRunning.value) { frontendControl?.stop(); return }; if (busy.value) return; creating.value=false; error.value='' }
watch([creating, () => state.tab], async () => {
  await nextTick()
  if (modalOpen() && state.tab === 'workspace') { if (!projectDialog.value?.open) projectDialog.value?.showModal() }
  else projectDialog.value?.close()
})
const workspace = ref<InstanceType<typeof PageWorkspace>>()
async function prepareUpdate(): Promise<boolean> {
  if (busy.value || modalOpen()) return false
  dismissDelete(false)
  return current.value ? !!(await workspace.value?.prepareLeave()) : true
}
async function agentOpen(id: string) {
  if (!(await prepareUpdate())) throw new Error('请先完成当前项目编辑或新建操作')
  if (current.value?.id === id) return
  const doc = await window.api.pagesRead(id)
  current.value = doc
}
async function beginRemote(id: string, lease: string) {
  if (current.value?.id === id) await workspace.value?.beginRemote(lease)
}
async function endRemote(id: string, lease: string) {
  await refresh()
  if (current.value?.id === id) {
    if (!sessions.value.some(s => s.id === id)) current.value = null
    else await workspace.value?.endRemote(lease)
  }
}
const desktopState = () => workspace.value?.desktopState() ?? null
const isCreating = () => creating.value
async function frontendAction(a: FrontendRequest, ctx: FrontendContext) {
  if (a.action === 'open') {
    await agentOpen(a.id!); await nextTick(); await ctx.step('已打开工作台项目')
  } else if (a.action === 'create') {
    if (!(await prepareUpdate())) throw new Error('请先完成当前编辑或新建操作')
    current.value = null; newSession(a.image)
    title.value = a.title!; start.value = a.source === 'image' ? 'gallery' : a.source!
    await ctx.step('已填写新建项目表单')
    await create()
    if (error.value || !current.value) throw new Error(error.value || '项目未创建')
    await nextTick(); await ctx.step('项目已创建并显示')
  } else {
    if (creating.value || busy.value || !workspace.value || current.value?.id !== a.id) throw new Error('目标项目未在前台打开，请先使用 ui_open_workspace')
    if (a.action === 'delete-project') {
      if (a.confirm !== true) throw new Error('缺少删除授权')
      if (!(await prepareUpdate())) throw new Error('请先完成当前编辑')
      const doc = await window.api.pagesRead(a.id!)
      current.value = null; await refresh(); await nextTick()
      const index = sessions.value.findIndex(s => s.id === a.id)
      const button = document.querySelectorAll<HTMLButtonElement>('.session-delete')[index]
      if (!button) throw new Error('项目未在列表中显示，请重新读取状态')
      await confirmDelete(a.id!, { currentTarget: button } as unknown as MouseEvent)
      try {
        await ctx.step('已显示目标项目与图片清理提示')
        busy.value = true
        await window.api.pagesDelete(doc.id, doc.revision)
        dismissDelete(false); await refresh(); await ctx.step('项目已归档，所属图片已清理')
      } finally { busy.value = false; dismissDelete(false) }
    } else await workspace.value.frontendAction(a, ctx)
  }
}
defineExpose({ prepareUpdate, agentOpen, beginRemote, endRemote, desktopState, isCreating, frontendAction })
async function refresh() {
  error.value = ''
  try { sessions.value = await window.api.pagesList() } catch(e) { error.value = cleanErr(e) }
}
watch(() => state.tab, t => { if(t === 'workspace' && !current.value) void refresh() })
onMounted(refresh)
async function open(id: string) {
  if (busy.value) return
  dismissDelete(false)
  busy.value = true; error.value = ''
  try { current.value = await window.api.pagesRead(id) } catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
function newSession(image?: NaiImage) { dismissDelete(false); creating.value = true; start.value = image ? 'gallery' : 'blank'; selectedImage.value=image ?? null; title.value = ''; error.value = '' }
watch(() => state.workspaceImage, async image => {
  if (!image) return
  state.workspaceImage=null
  if (busy.value) { error.value='请等待当前操作完成，再选择项目图片。'; return }
  if (current.value && !(await workspace.value?.prepareLeave())) return
  current.value=null
  if (creating.value) { selectedImage.value=image; start.value='gallery'; error.value='' }
  else newSession(image)
  void refresh()
})
async function create() {
  if (busy.value || start.value === 'gallery' && !selectedImage.value) return
  busy.value = true; error.value = ''
  try {
    // 沿用生图预览里的步数、Guidance、采样器等设置（种子随机、每次一张），不再悄悄换成默认值
    const params: NaiGenParams = { ...state.params, ...loadGenParams(), count:1, seed:null }
    const draft = start.value === 'current' ? { base:state.prompt, negative:state.negative, characters:state.characters.map(c=>({...c})) } : {base:'',negative:'',characters:[]}
    let doc = start.value === 'import' ? await window.api.pagesImport(params, state.settings?.naiVersion ?? 'v5', draft)
      : await window.api.pagesCreate(start.value === 'gallery' ? selectedImage.value!.name : null, params, state.settings?.naiVersion ?? 'v5', draft)
    if (!doc) return
    // 项目已经建好：改名失败也直接打开，避免用户再点「开始项目」建出重复的项目
    let renameError = ''
    if (title.value.trim()) {
      try { doc = await window.api.pagesEdit(doc.id, doc.revision, {type:'notes',title:title.value,goal:doc.goal,preserve:doc.preserve,composer:''}) }
      catch (e) { renameError = cleanErr(e) }
    }
    current.value = doc; creating.value = false; await refresh()
    if (renameError) toast(`项目已创建，但名称未保存：${renameError}。可在项目顶部点击标题重命名`)
  } catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
const deletePopover = ref<HTMLElement>()
const deleteTrigger = ref<HTMLButtonElement>()
const deletePosition = ref({left:'0px',top:'0px'})
const deleteAbove = ref(true)
const deleteError = ref('')
function dismissDelete(restoreFocus = true) {
  deletePopover.value?.hidePopover()
  deleting.value=null;deleteError.value=''
  if(restoreFocus && deleteTrigger.value?.isConnected) deleteTrigger.value.focus({preventScroll:true})
}
async function confirmDelete(id: string, event: MouseEvent) {
  if(busy.value)return
  deleteTrigger.value=event.currentTarget as HTMLButtonElement
  deleting.value=id;deleteError.value=''
  await nextTick()
  const popup=deletePopover.value, trigger=deleteTrigger.value
  if(!popup || !trigger)return
  popup.showPopover()
  const r=trigger.getBoundingClientRect(), p=popup.getBoundingClientRect()
  deleteAbove.value=r.top-p.height-9>=48
  const top=deleteAbove.value ? r.top-p.height-9 : r.bottom+9
  deletePosition.value={left:`${Math.max(8,Math.min(r.right-p.width,innerWidth-p.width-8))}px`,top:`${Math.max(48,Math.min(top,innerHeight-p.height-8))}px`}
  await nextTick()
  popup.querySelector<HTMLButtonElement>('.delete-cancel')?.focus({preventScroll:true})
}
function deleteToggle(event: Event) {
  if((event as ToggleEvent).newState==='closed') { deleting.value=null;deleteError.value='' }
}
function deleteScroll(event: Event) { if(!deletePopover.value?.contains(event.target as Node))dismissDelete(false) }
function deleteResize() { dismissDelete(false) }
watch(()=>state.tab,()=>dismissDelete(false))
onMounted(()=>{document.addEventListener('scroll',deleteScroll,true);window.addEventListener('resize',deleteResize)})
onBeforeUnmount(()=>{document.removeEventListener('scroll',deleteScroll,true);window.removeEventListener('resize',deleteResize)})
async function remove(id: string) {
  if(busy.value)return
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.session-delete')], index=buttons.indexOf(deleteTrigger.value!)
  const next=buttons[index+1] ?? buttons[index-1]
  busy.value=true;deleteError.value=''
  try {
    if (id === 'removed-images') {
      const count = await window.api.pagesCleanupRemovedImages()
      toast(count ? `已清理 ${count} 张遗留图片，移入系统回收站` : '没有可清理的遗留图片')
    } else {
      const doc=await window.api.pagesRead(id)
      await window.api.pagesDelete(id,doc.revision)
      toast('项目已删除，所属图片已清理；其他项目引用的图片保留')
    }
    dismissDelete(false)
    await refresh();busy.value=false;await nextTick()
    next?.focus({preventScroll:true})
  } catch(e) { deleteError.value=cleanErr(e); if(!deleting.value)error.value=deleteError.value }
  finally {busy.value=false}
}
async function close() { current.value = null; await refresh() }
</script>

<template>
  <div class="sessions-view">
    <PageWorkspace ref="workspace" v-if="current" :key="current.id" :workspace="current" @close="close" />
    <section v-else class="sessions-home scroll">
      <header><div><h1>创作项目 <span class="pill">{{ sessions.length }}</span></h1></div><div class="row"><button class="btn ghost small" :disabled="busy" title="清理以前删除的项目留下的图片" @click="confirmDelete('removed-images',$event)"><Icon name="trash" :size="14"/>清理遗留图片</button><button class="btn accent" :disabled="busy" @click="newSession()"><Icon name="plus" />新建项目</button></div></header>
      <div v-if="error && !modalOpen()" class="error-box" role="alert">{{ error }}</div>
      <div v-if="!sessions.length" class="session-empty"><Icon name="chat" :size="36" /><p>暂无项目</p><button class="btn primary" @click="newSession()">创建第一个项目</button></div>
      <div class="session-grid">
        <article v-for="s in sessions" :key="s.id" class="session-card">
          <button class="session-open" :disabled="busy" @click="open(s.id)"><img v-if="s.image && !s.image.missing" :src="s.image.url" alt="" loading="lazy"><span v-else class="session-placeholder"><Icon name="chat" :size="26" /></span><span><b :title="s.title">{{ s.title }}</b><small>{{ s.versions }} 个版本记录 · {{ s.messages }} 条讨论</small><small class="session-time">{{ new Date(s.updatedAt).toLocaleString('zh-CN') }}</small></span><Icon name="arrow" /></button>
          <button class="session-delete" :disabled="busy" title="删除项目" :aria-label="`删除项目：${s.title}`" aria-haspopup="dialog" :aria-expanded="deleting===s.id" @click="confirmDelete(s.id,$event)"><Icon name="trash" :size="14" /></button>
        </article>
      </div>
    </section>
    <div ref="deletePopover" popover="auto" class="session-delete-popover" :data-above="deleteAbove" :style="deletePosition" role="alertdialog" aria-label="确认删除项目" aria-describedby="delete-project-question" @toggle="deleteToggle">
      <p id="delete-project-question">{{ deleting === 'removed-images' ? '清理已删项目的遗留图片？' : '删除项目并清理图片？' }}</p>
      <span class="delete-project-name" :title="sessions.find(s=>s.id===deleting)?.title">{{ sessions.find(s=>s.id===deleting)?.title }}</span>
      <span class="delete-project-detail">{{ deleting === 'removed-images' ? '清理已删项目与无归属项目的图片及生成文件。' : '项目记录归档，所属图片及生成文件移入系统回收站。' }}其他项目仍引用的图片保留。</span>
      <p v-if="deleteError" class="delete-error" role="alert">{{ deleteError }}</p>
      <div class="row"><button class="btn ghost small delete-cancel" :disabled="busy" @click="dismissDelete()">取消</button><button class="btn primary small" :disabled="busy || !deleting" @click="deleting && remove(deleting)">{{ busy ? '清理中…' : deleting === 'removed-images' ? '确认清理' : '确认删除' }}</button></div>
    </div>
    <dialog ref="projectDialog" class="project-dialog" aria-label="创作项目管理" @cancel.prevent="dismissDialog" @click="e=>{if(e.target===projectDialog)dismissDialog()}">
      <button v-if="frontendRunning" class="btn small ghost project-agent-stop" @click="frontendControl?.stop()">Agent 正在操作 · 停止</button>
      <section v-if="creating" class="session-create" :inert="frontendRunning">
        <div class="row"><h3>新建项目</h3><button class="icon-btn ml-auto" :disabled="busy" title="取消新建" @click="dismissDialog"><Icon name="x" /></button></div>
        <label>项目名称（可选）<input v-model="title" class="input" maxlength="100" placeholder="给这次尝试起个名字" :disabled="busy"></label>
        <label>从哪里开始<ThemeSelect v-model="start" :disabled="busy" :options="[{value:'blank',label:'从描述开始'},{value:'current',label:'复制当前提示词'},{value:'gallery',label:'使用图库图片'},{value:'import',label:'导入 PNG 图片'}]" /></label>
        <div v-if="start==='gallery'" class="session-image">
          <template v-if="selectedImage"><img :src="selectedImage.url" alt="项目基础图片"><div><b>基础图片</b><span>{{ selectedImage.width }} × {{ selectedImage.height }}</span></div></template>
          <button class="btn small" :disabled="busy" @click="state.tab='generate'"><Icon name="image" :size="14"/>{{ selectedImage?'重新选择':'前往生图预览选图' }}</button>
        </div>
          <button class="btn primary" :disabled="busy || start==='gallery' && !selectedImage" @click="create">{{ start==='import' ? '选择 PNG 并开始' : '开始项目' }}</button>
      </section>

      <div v-if="error" class="error-box" role="alert">{{ error }}</div>
    </dialog>
  </div>
</template>

<style scoped>
.delete-project-detail{display:block;color:var(--muted);font-size:12px;line-height:1.7;margin-top:8px}
.project-agent-stop{position:absolute;right:18px;top:18px;color:var(--pink-deep);background:var(--bg);z-index:1}
.project-dialog{width:min(600px,calc(100vw - 48px));max-height:calc(100vh - 100px);padding:24px;border:1px solid var(--pink-line);border-radius:18px;background:var(--bg);color:var(--text);box-shadow:0 18px 70px #0002;overflow:auto}.project-dialog::backdrop{background:#16151d66}.project-dialog .session-create{padding:0;border:0;margin:0;background:transparent;max-width:none}.project-dialog h3{margin:0;font-size:16px}.project-dialog p{font-size:12px;line-height:1.8;color:var(--text2)}.project-dialog .error-box{margin-top:14px}.sessions-home header p{margin:8px 0 0}.project-dialog .session-remove span{width:auto}

.sessions-view{height:100%;min-height:0;background:var(--panel)}.sessions-home{height:100%;padding:32px;max-width:1500px;margin:auto}.sessions-home>header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:30px}.sessions-home h1{font-size:20px;margin:0}.sessions-home p{font-size:13px;color:var(--muted);line-height:1.8}.session-create{border:1px solid var(--pink-line);background:var(--bg);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:14px;max-width:640px;margin-bottom:28px}.session-create label{display:flex;flex-direction:column;gap:8px;font-size:12px}.session-create>.btn{align-self:flex-start}.session-list-head{display:flex;align-items:center;gap:12px;margin:25px 0 15px}.session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.session-card{position:relative;border:1px solid var(--line);background:var(--bg);border-radius:16px;overflow:hidden;padding:6px}.session-open{width:100%;display:flex;align-items:center;gap:14px;text-align:left;padding:12px}.session-open img,.session-placeholder{width:58px;height:76px;object-fit:contain;background:var(--panel);border-radius:8px;flex-shrink:0}.session-placeholder{display:grid;place-items:center;color:var(--pink)}.session-open>span:not(.session-placeholder){display:flex;flex:1;min-width:0;flex-direction:column;gap:8px}.session-open b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.session-open small{font-size:11px;color:var(--muted)}.session-delete{position:absolute;right:18px;bottom:18px;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;color:var(--muted);background:var(--bg)}.session-time{padding-right:24px;white-space:nowrap}.session-open>svg{flex-shrink:0;align-self:flex-start;margin-top:16px}.session-delete:hover{color:var(--bad)}.session-remove{border-top:1px solid var(--line);padding:12px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px}.session-remove span{width:100%}.session-empty{padding:65px;text-align:center;color:var(--muted)}.session-empty .btn{margin-top:16px}
.session-image{display:flex;align-items:center;gap:16px;padding:12px;border:1px solid var(--line);border-radius:12px;flex-wrap:wrap}.session-image img{width:120px;height:150px;object-fit:contain;background:var(--panel);border-radius:8px}.session-image>div{display:flex;flex-direction:column;gap:6px;font-size:12px}.session-image span{color:var(--muted)}.session-image .btn{margin-left:auto}
.session-delete-popover{position:fixed;inset:auto;margin:0;width:250px;max-width:calc(100vw - 16px);padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--text);box-shadow:0 8px 28px #24202c20;overflow:visible}.session-delete-popover::after{content:"";position:absolute;right:8px;bottom:-5px;width:8px;height:8px;background:var(--bg);border-right:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg)}.session-delete-popover[data-above="false"]::after{top:-5px;bottom:auto;border:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}.session-delete-popover::backdrop{background:transparent}.session-delete-popover p{margin:0 0 6px;font-size:13px;font-weight:600}.delete-project-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:12px}.session-delete-popover .row{justify-content:flex-end;gap:8px;margin-top:14px}.session-delete-popover .delete-error{color:var(--bad);font-size:12px;font-weight:400;margin-top:10px;overflow-wrap:anywhere}
</style>
