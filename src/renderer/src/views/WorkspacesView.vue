<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { FrontendRequest, FrontendContext } from '@shared/desktop'
import type { PageWorkspace as Session, PageWorkspaceSummary } from '@shared/page-workspace'
import type { NaiImage, NaiGenParams } from '@shared/types'
import { state, cleanErr } from '../store'
import PageWorkspace from '../components/PageWorkspace.vue'
import Icon from '../components/Icon.vue'
import ThemeSelect from '../components/ThemeSelect.vue'

const sessions = ref<PageWorkspaceSummary[]>([]), current = ref<Session | null>(null)
const creating = ref(false), busy = ref(false), error = ref(''), deleting = ref<string | null>(null)
const start = ref('blank'), title = ref(''), selectedImage = ref<NaiImage | null>(null)
const workspace = ref<InstanceType<typeof PageWorkspace>>()
async function prepareUpdate(): Promise<boolean> {
  if (busy.value || creating.value) return false
  return current.value ? !!(await workspace.value?.prepareLeave()) : true
}
async function agentOpen(id: string) {
  if (!(await prepareUpdate())) throw new Error('请先完成当前会话编辑或新建操作')
  if (current.value?.id === id) return
  const doc = await window.api.pagesRead(id)
  current.value = doc
}
async function beginRemote(id: string, lease: string) {
  if (current.value?.id === id) await workspace.value?.beginRemote(lease)
}
async function endRemote(id: string, lease: string) {
  if (current.value?.id === id) await workspace.value?.endRemote(lease)
  await refresh()
}
const desktopState = () => workspace.value?.desktopState() ?? null
const isCreating = () => creating.value
async function frontendAction(a: FrontendRequest, ctx: FrontendContext) {
  if (a.action === 'open') {
    await agentOpen(a.id!); await nextTick(); await ctx.step('已打开工作台会话')
  } else if (a.action === 'create') {
    if (!(await prepareUpdate())) throw new Error('请先完成当前编辑或新建操作')
    current.value = null; newSession(a.image)
    title.value = a.title!; start.value = a.source === 'image' ? 'gallery' : a.source!
    await ctx.step('已填写新建会话表单')
    await create()
    if (error.value || !current.value) throw new Error(error.value || '会话未创建')
    await nextTick(); await ctx.step('会话已创建并显示')
  } else {
    if (creating.value || busy.value || !workspace.value || current.value?.id !== a.id) throw new Error('目标会话未在前台打开，请先使用 ui_open_workspace')
    await workspace.value.frontendAction(a, ctx)
  }
}
defineExpose({ prepareUpdate, agentOpen, beginRemote, endRemote, desktopState, isCreating, frontendAction })
async function refresh() { try { sessions.value = await window.api.pagesList() } catch(e) { error.value = cleanErr(e) } }
watch(() => state.tab, t => { if(t === 'workspace' && !current.value) void refresh() })
onMounted(refresh)
async function open(id: string) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { current.value = await window.api.pagesRead(id) } catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
function newSession(image?: NaiImage) { creating.value = true; start.value = image ? 'gallery' : 'blank'; selectedImage.value=image ?? null; title.value = ''; error.value = '' }
watch(() => state.workspaceImage, async image => {
  if (!image) return
  state.workspaceImage=null
  if (busy.value) { error.value='请等待当前操作完成，再选择会话图片。'; return }
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
    const params: NaiGenParams = { ...state.params, count:1, seed:null, steps:23, scale:5, cfgRescale:0, sampler:'k_euler_ancestral', noiseSchedule:'native' }
    const draft = start.value === 'current' ? { base:state.prompt, negative:state.negative, characters:state.characters.map(c=>({...c})) } : {base:'',negative:'',characters:[]}
    let doc = start.value === 'import' ? await window.api.pagesImport(params, state.settings?.naiVersion ?? 'v5', draft)
      : await window.api.pagesCreate(start.value === 'gallery' ? selectedImage.value!.name : null, params, state.settings?.naiVersion ?? 'v5', draft)
    if (!doc) return
    if (title.value.trim()) doc = await window.api.pagesEdit(doc.id, doc.revision, {type:'notes',title:title.value,goal:doc.goal,preserve:doc.preserve,composer:''})
    current.value = doc; creating.value = false; await refresh()
  } catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
async function remove(id: string) {
  busy.value = true; error.value = ''
  try { const doc = await window.api.pagesRead(id); await window.api.pagesDelete(id,doc.revision); deleting.value = null; await refresh() }
  catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
async function close() { current.value = null; await refresh() }
</script>

<template>
  <div class="sessions-view">
    <PageWorkspace ref="workspace" v-if="current" :key="current.id" :workspace="current" @close="close" />
    <section v-else class="sessions-home scroll">
      <header><div><h1>会话 <span class="pill">{{ sessions.length }}</span></h1></div><button class="btn accent" :disabled="busy" @click="newSession()"><Icon name="plus" />新建会话</button></header>
      <div v-if="error" class="error-box" role="alert">{{ error }}</div>
      <section v-if="creating" class="session-create">
        <div class="row"><h3>新建会话</h3><button class="icon-btn ml-auto" :disabled="busy" title="取消新建" @click="creating=false"><Icon name="x" /></button></div>
        <label>会话名称（可选）<input v-model="title" class="input" maxlength="100" placeholder="给这次尝试起个名字" :disabled="busy"></label>
        <label>从哪里开始<ThemeSelect v-model="start" :disabled="busy" :options="[{value:'blank',label:'从描述开始'},{value:'current',label:'复制当前提示词'},{value:'gallery',label:'使用图库图片'},{value:'import',label:'导入 PNG 图片'}]" /></label>
        <div v-if="start==='gallery'" class="session-image">
          <template v-if="selectedImage"><img :src="selectedImage.url" alt="会话基础图片"><div><b>基础图片</b><span>{{ selectedImage.width }} × {{ selectedImage.height }}</span></div></template>
          <button class="btn small" :disabled="busy" @click="state.tab='generate'"><Icon name="image" :size="14"/>{{ selectedImage?'重新选择':'前往生图预览选图' }}</button>
        </div>
          <button class="btn primary" :disabled="busy || start==='gallery' && !selectedImage" @click="create">{{ start==='import' ? '选择 PNG 并开始' : '开始会话' }}</button>
      </section>
      <div v-if="!sessions.length && !creating" class="session-empty"><Icon name="chat" :size="36" /><p>暂无会话</p><button class="btn primary" @click="newSession()">创建第一个会话</button></div>
      <div class="session-grid">
        <article v-for="s in sessions" :key="s.id" class="session-card">
          <button class="session-open" :disabled="busy" @click="open(s.id)"><img v-if="s.image" :src="s.image.url" alt="" loading="lazy"><span v-else class="session-placeholder"><Icon name="chat" :size="26" /></span><span><b>{{ s.title }}</b><small>{{ s.versions }} 个状态 · {{ s.messages }} 次输入</small><small>{{ new Date(s.updatedAt).toLocaleString('zh-CN') }}</small></span><Icon name="arrow" /></button>
          <div v-if="deleting===s.id" class="session-remove"><span>删除此会话记录？图库图片会保留。</span><button class="btn small" :disabled="busy" @click="deleting=null">取消</button><button class="btn small primary" :disabled="busy" @click="remove(s.id)">确认删除</button></div>
          <button v-else class="session-delete" :disabled="busy" title="删除会话" @click="deleting=s.id"><Icon name="trash" :size="14" />删除</button>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sessions-view{height:100%;min-height:0;background:var(--panel)}.sessions-home{height:100%;padding:32px;max-width:1500px;margin:auto}.sessions-home>header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:30px}.sessions-home h1{font-size:20px;margin:0}.sessions-home p{font-size:13px;color:var(--muted);line-height:1.8}.session-create{border:1px solid var(--pink-line);background:var(--bg);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:14px;max-width:640px;margin-bottom:28px}.session-create label{display:flex;flex-direction:column;gap:8px;font-size:12px}.session-create>.btn{align-self:flex-start}.session-list-head{display:flex;align-items:center;gap:12px;margin:25px 0 15px}.session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.session-card{border:1px solid var(--line);background:var(--bg);border-radius:16px;overflow:hidden;padding:6px}.session-open{width:100%;display:flex;align-items:center;gap:14px;text-align:left;padding:12px}.session-open img,.session-placeholder{width:58px;height:76px;object-fit:contain;background:var(--panel);border-radius:8px;flex-shrink:0}.session-placeholder{display:grid;place-items:center;color:var(--pink)}.session-open>span:not(.session-placeholder){display:flex;flex:1;min-width:0;flex-direction:column;gap:8px}.session-open b{font-size:14px;overflow-wrap:anywhere}.session-open small{font-size:11px;color:var(--muted)}.session-delete{display:flex;align-items:center;gap:5px;margin:0 12px 8px auto;color:var(--muted);font-size:11px}.session-delete:hover{color:var(--bad)}.session-remove{border-top:1px solid var(--line);padding:12px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px}.session-remove span{width:100%}.session-empty{padding:65px;text-align:center;color:var(--muted)}.session-empty .btn{margin-top:16px}
.session-image{display:flex;align-items:center;gap:16px;padding:12px;border:1px solid var(--line);border-radius:12px;flex-wrap:wrap}.session-image img{width:120px;height:150px;object-fit:contain;background:var(--panel);border-radius:8px}.session-image>div{display:flex;flex-direction:column;gap:6px;font-size:12px}.session-image span{color:var(--muted)}.session-image .btn{margin-left:auto}
</style>
