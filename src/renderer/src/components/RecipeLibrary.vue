<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { NaiGenRequest, NaiGenParams, SavedRecipe } from '@shared/types'
import { cleanErr } from '../store'
const props = defineProps<{ workspace?: boolean; currentRequest?: NaiGenRequest; initialId?: string }>()
const emit = defineEmits<{ close: []; apply: [request: NaiGenRequest] }>()
const items = ref<SavedRecipe[]>([]), query = ref(''), selected = ref<SavedRecipe | null>(null)
const error = ref(''), tags = ref(''), busy = ref(false), confirmDelete = ref(false), keepSeed = ref(true)
const searchInput = ref<HTMLInputElement>()
const previousFocus = document.activeElement as HTMLElement | null
const fields: [keyof NaiGenParams, string][] = [['width','宽度'],['height','高度'],['steps','步数'],['scale','提示词引导'],['cfgRescale','引导重缩放'],['sampler','采样器'],['noiseSchedule','噪声调度'],['seed','种子'],['count','生成张数'],['qualityTags','自动质量词'],['ucPreset','负面预设']]
function display(value: unknown) { return value == null ? '随机' : typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value) }
const filtered = computed(() => items.value.filter(r => [r.name, r.note, ...r.tags].join(' ').toLowerCase().includes(query.value.toLowerCase())))
async function refresh() { try { items.value = await window.api.recipesList() } catch (e) { error.value = cleanErr(e) } }
onMounted(async () => { await refresh(); const item = items.value.find(r => r.id === props.initialId) ?? items.value[0]; if (item) select(item); await nextTick(); searchInput.value?.focus() })
onBeforeUnmount(() => previousFocus?.focus())
function select(r: SavedRecipe) { selected.value = JSON.parse(JSON.stringify(r)); tags.value = r.tags.join(', '); confirmDelete.value = false; keepSeed.value = true }
async function saveCurrent() {
  if (!props.currentRequest || busy.value) return
  busy.value = true; error.value = ''
  try { const item = await window.api.recipesCreateConfig(JSON.parse(JSON.stringify(props.currentRequest))); query.value = ''; await refresh(); select(item) }
  catch(e) { error.value = cleanErr(e) } finally { busy.value = false }
}
async function save() {
  if (!selected.value || busy.value) return
  busy.value = true; error.value = ''
  try { selected.value = await window.api.recipesUpdate(selected.value.id, { name: selected.value.name, note: selected.value.note, tags: tags.value.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); await refresh() }
  catch (e) { error.value = cleanErr(e) } finally { busy.value = false }
}
async function remove() {
  if (!selected.value || busy.value) return
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  busy.value = true
  try { await window.api.recipesDelete(selected.value.id); selected.value = null; await refresh() } catch (e) { error.value = cleanErr(e) } finally { busy.value = false }
}
function apply() {
  if (!selected.value) return
  const request: NaiGenRequest = JSON.parse(JSON.stringify(selected.value.recipe.request))
  if (!keepSeed.value) request.params.seed = null
  emit('apply', request)
}
</script>
<template>
  <Teleport to="body">
    <div class="recipe-backdrop" @keydown.esc.stop="emit('close')">
      <section class="recipe-dialog" role="dialog" aria-modal="true" aria-label="配置收藏" tabindex="-1">
        <header><div><b>配置收藏</b><p class="muted small">保存完整提示词和生图设置，选中后即可加载使用。</p></div><button class="btn small" @click="emit('close')">关闭</button></header>
        <div v-if="currentRequest" class="recipe-save-current"><button class="btn small" :disabled="busy" @click="saveCurrent">收藏当前配置</button><span class="muted small">无需先生成图片</span></div>
        <p v-if="error" class="error-box" role="alert">{{ error }}</p>
        <div class="recipe-columns">
          <aside><input ref="searchInput" v-model="query" class="input" placeholder="搜索名称、备注或标签" aria-label="搜索配置"><p v-if="!filtered.length" class="muted">暂无匹配的配置。可收藏当前配置，或在图片上点击「收藏此图配置」。</p><button v-for="r in filtered" :key="r.id" :class="['recipe-item',{on:selected?.id===r.id}]" @click="select(r)"><img v-if="r.thumbnail" :src="r.thumbnail" alt="配置示例"><span>{{ r.name }}<small>{{ r.tags.join(' · ') }}</small></span></button></aside>
          <article v-if="selected">
            <label>名称<input v-model="selected.name" class="input" maxlength="100"></label>
            <details class="recipe-notes"><summary>标签与备注（可选）</summary>
            <label>标签（逗号分隔）<input v-model="tags" class="input"></label>
            <label>备注<textarea v-model="selected.note" class="input" maxlength="6000" rows="2"></textarea></label>
            </details>
            <div class="row"><button class="btn small" :disabled="busy" @click="save">保存修改</button><button class="btn ghost small" :disabled="busy" @click="remove">{{ confirmDelete ? '确认删除收藏' : '删除收藏' }}</button></div>
            <p>加载后将替换{{ props.workspace ? '本会话' : '当前' }}提示词、角色、模型和生成设置{{ props.workspace ? '，清除旧选区并切换为整图生成' : '' }}。</p>
            <p v-if="selected.recipe.sourceKind==='inpaint'" class="error-box">此配置来自局部重绘，仅复用提示词与设置，不包含底图和遮罩，不能直接还原重绘过程。</p>
            <details open><summary>完整生成配置 · {{ selected.recipe.request.version.toUpperCase() }}</summary>
              <div class="recipe-preview"><b>主提示词</b><pre>{{ selected.recipe.request.base || '空' }}</pre><b>负面提示词</b><pre>{{ selected.recipe.request.negative || '空' }}</pre>
                <div v-for="(c,i) in selected.recipe.request.characters" :key="i"><b>角色 {{ i+1 }} · 位置 {{ c.position || '自动' }}</b><pre>{{ c.prompt }}</pre><pre>角色负面：{{ c.negative || '空' }}</pre></div>
                <dl><template v-for="[key,label] in fields" :key="key"><dt>{{ label }}</dt><dd>{{ display(selected.recipe.request.params[key]) }}</dd></template></dl>
                <p v-if="selected.sourceImage">此图配置记录单张图片的实际生成设置，质量词与负面预设已合并到提示词中。</p>
              </div>
            </details>
          </article><p v-else class="muted">选择一个收藏的配置即可加载。</p>
        </div>
        <footer v-if="selected" class="recipe-load"><label class="seed-option"><input v-model="keepSeed" type="checkbox">保留收藏中的种子（{{ display(selected.recipe.request.params.seed) }}）</label><button class="btn primary" :disabled="busy" @click="apply">加载配置</button><small v-if="!keepSeed" class="muted">加载时仅将种子改为随机，其余配置保持不变。</small></footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.recipe-columns article > * { flex-shrink: 0; }
.recipe-notes label { margin-top: 10px; }
.recipe-preview{padding-top:12px;font-size:12px}.recipe-preview dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}.recipe-preview dd{margin:0;overflow-wrap:anywhere}
.recipe-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center;padding:24px}.recipe-dialog{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:18px;padding:22px;width:min(960px,95vw);height:min(780px,90vh);overflow:hidden;display:flex;flex-direction:column}.recipe-dialog header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.recipe-columns{min-height:0;flex:1;display:grid;grid-template-columns:minmax(180px,1fr) minmax(0,2fr);gap:24px}.recipe-columns aside{min-height:0;overflow:auto;padding-right:10px;scrollbar-gutter:stable}.recipe-columns article{min-height:0;overflow:auto;padding-right:10px;scrollbar-gutter:stable;display:flex;flex-direction:column;gap:12px}.recipe-columns label{display:flex;flex-direction:column;gap:5px;font-size:12px}.recipe-columns p{font-size:12px;line-height:1.8}.recipe-columns .seed-option{flex-direction:row;align-items:center}.recipe-item{display:flex;gap:10px;align-items:center;width:100%;padding:10px;text-align:left;border-radius:10px;overflow-wrap:anywhere}.recipe-item.on{background:var(--pink-bg)}.recipe-item img{width:50px;height:65px;object-fit:contain}.recipe-item small{display:block;color:var(--muted);margin-top:6px}.recipe-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.recipe-dialog summary{cursor:pointer;font-size:12px}@media(max-width:650px){.recipe-columns{grid-template-columns:1fr;grid-template-rows:minmax(80px,180px) minmax(0,1fr)}.recipe-columns aside{max-height:180px}}
.recipe-dialog header,.recipe-save-current,.recipe-load{flex-shrink:0}.recipe-save-current{display:flex;align-items:center;gap:10px;margin-bottom:14px}.recipe-load{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.recipe-load .btn{margin-left:auto}.recipe-load small{width:100%}.seed-option{display:flex;align-items:center;gap:6px;font-size:12px}.recipe-dialog>.error-box{max-height:80px;overflow:auto;flex-shrink:0}.recipe-dialog header p{margin:8px 0 0}
</style>
