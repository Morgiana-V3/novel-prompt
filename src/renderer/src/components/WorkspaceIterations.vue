<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { pageGroups, pageChanges, pageIteration, type PageWorkspace } from '@shared/page-workspace'
import type { NaiGenParams } from '@shared/types'
import { changeLabel } from '@shared/inpaint-plan'
import { diffPrompt } from '../prompt-diff'
import ThemeSelect from './ThemeSelect.vue'
import DiffChips from './DiffChips.vue'

const props = defineProps<{ work: PageWorkspace; versionId: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const compareId = ref('')
watch(() => props.versionId, () => { compareId.value = '' })
const iteration = computed(() => {
  const original = pageIteration(props.work, props.versionId)
  if (!compareId.value) return original
  const source = props.work.versions.find(v => v.id === compareId.value)
  const before = source?.generated ?? source?.initial
  return { ...original, source, before, changes: original.result && before ? pageChanges(before.draft, original.result.draft) : [] }
})
const records = computed(() => props.work.versions.filter(v => v.generated || !v.parentId).slice().reverse())
const groups = computed(() => pageGroups(props.work).slice().reverse())
const selectedGroup = computed(() => groups.value.find(g => g.versions.some(v => v.id === props.versionId)))
function selectGroup(group: ReturnType<typeof pageGroups>[number]) {
  emit('select', (group.versions.find(v => v.id === props.versionId) ?? group.versions.find(v => v.id === props.work.currentVersionId) ?? group.versions[group.versions.length - 1]).id)
}
function name(id: string) {
  const i = props.work.versions.findIndex(v => v.id === id)
  return props.work.versions[i]?.label ?? '历史版本'
}
const fields: [keyof NaiGenParams, string][] = [
  ['width', '宽度'], ['height', '高度'], ['steps', '步数'], ['scale', '提示词引导'],
  ['cfgRescale', '引导重缩放'], ['sampler', '采样器'], ['noiseSchedule', '噪声调度'], ['seed', '种子']
]
function value(v: unknown) { return v === null ? '随机' : v === undefined ? '未记录' : String(v) }
const parameters = computed(() => {
  const { result, before, source } = iteration.value
  if (!result) return []
  const rows = fields.filter(([k]) => !before || before.params[k] !== result.params[k])
    .map(([k, label]) => ({ label, before: value(before?.params[k]), after: value(result.params[k]) }))
  if (result.inpaint && result.inpaint.strength !== source?.generated?.inpaint?.strength)
    rows.push({ label: '重绘强度', before: source?.generated?.inpaint ? value(source.generated.inpaint.strength) : '—', after: value(result.inpaint.strength) })
  return rows
})
const maskUrl = computed(() => {
  const mask = iteration.value.result?.inpaint?.mask
  return mask ? (mask.startsWith('data:') ? mask : `data:image/png;base64,${mask}`) : ''
})
</script>

<template>
  <section class="wi">
    <nav class="wi-timeline" aria-label="迭代记录">
      <button v-for="g in groups" :key="g.id" :class="{on:g.id===selectedGroup?.id}" @click="selectGroup(g)">
        <b>{{ g.label.replace('方案 ', '版本 ') }}</b><span>{{ g.versions.length }} 张记录</span><span v-if="g.versions.some(v=>v.id===work.currentVersionId)" class="wi-current">当前</span>
      </button>
    </nav>
    <article v-if="iteration.result" class="wi-record">
      <label v-if="selectedGroup && selectedGroup.versions.length>1" class="small">本版本生成图 <ThemeSelect :model-value="versionId" :options="selectedGroup.versions.map((v,i)=>({value:v.id,label:`第 ${i+1} 张${v.id===work.currentVersionId?' · 已采用':''}`}))" aria-label="本版本生成图" @update:model-value="emit('select',String($event))" /></label>
      <label class="small">对比对象 <ThemeSelect v-model="compareId" :options="[{value:'',label:'实际生成来源'},...records.filter(v=>v.id!==versionId).map(v=>({value:v.id,label:name(v.id)}))]" aria-label="对比对象" /></label>
      <div class="wi-heading"><b>{{ iteration.source ? name(iteration.source.id) : '来源版本' }} → {{ name(versionId) }}</b><span>{{ iteration.result.execution.kind==='inpaint'?'局部重绘':'提示词生图' }}</span><time>{{ new Date(iteration.version!.createdAt).toLocaleString('zh-CN') }}</time></div>
      <div class="wi-images">
        <figure><img v-if="iteration.source?.image && !iteration.source.image.missing" :src="iteration.source.image.url" @error="iteration.source.image.missing=true" alt="对比图片"><div v-else class="wi-no-image">{{ iteration.source?.image ? '图片缺失 · 文字记录保留' : '无基础图片' }}</div><figcaption>对比对象</figcaption></figure>
        <figure><img v-if="iteration.version?.image && !iteration.version.image.missing" :src="iteration.version.image.url" @error="iteration.version.image.missing=true" alt="本轮结果"><div v-else class="wi-no-image">图片缺失 · 文字记录保留</div><figcaption>本轮结果</figcaption></figure>
      </div>
      <p v-if="!iteration.before" class="muted small">旧版本未保存来源快照，无法可靠还原本轮差异。</p>
      <p v-else-if="!iteration.source?.generated" class="muted small">相对会话初始草稿与设置对比。</p>
      <div v-for="(c,i) in iteration.changes" :key="i" class="wi-change"><label>{{ changeLabel(c) }}</label><DiffChips :diff="diffPrompt(c.before,c.after)"/><p v-if="c.reason">{{ c.reason }}</p></div>
      <p v-if="iteration.before&&!iteration.changes.length" class="muted small">提示词未变</p>
      <table v-if="parameters.length" class="wi-params"><thead><tr><th>参数</th><th>修改前</th><th>本轮</th></tr></thead><tbody><tr v-for="p in parameters" :key="p.label"><th>{{ p.label }}</th><td>{{ p.before }}</td><td>{{ p.after }}</td></tr></tbody></table>
      <details v-if="iteration.result.inpaint" class="wi-mask"><summary>重绘区域{{ iteration.result.inpaint.label ? ` · ${iteration.result.inpaint.label}` : '' }}</summary><img :src="maskUrl" alt="本轮遮罩，白色为重绘区域"><p v-if="iteration.result.inpaint.instruction">{{ iteration.result.inpaint.instruction }}</p><p>重绘强度 {{ iteration.result.inpaint.strength }}<template v-if="iteration.result.inpaint.target != null"> · 角色 {{ iteration.result.inpaint.target+1 }}</template></p></details>
      <details class="wi-settings"><summary>本轮完整提示词与参数</summary><pre>{{ iteration.result.draft.base }}</pre><pre v-if="iteration.result.draft.negative">负面：{{ iteration.result.draft.negative }}</pre><div v-for="(c,i) in iteration.result.draft.characters" :key="i"><b>角色 {{ i+1 }} · {{ c.position||'自动位置' }}</b><pre>{{ c.prompt }}</pre><pre v-if="c.negative">负面：{{ c.negative }}</pre></div><dl><template v-for="[k,label] in fields" :key="k"><dt>{{ label }}</dt><dd>{{ value(iteration.result.params[k]) }}</dd></template></dl></details>
    </article>
    <p v-else class="muted small wi-start">{{ iteration.version?.parentId ? '此版本是保留的旧草稿，没有独立生成记录。' : '会话起点。生成后会在这里记录每轮结果及修改差异。' }}</p>
  </section>
</template>

<style scoped>
.wi-timeline{flex-direction:row}.wi-timeline button{flex-shrink:0}
.wi{margin:16px 0 24px;min-width:0}.wi-timeline{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px}.wi-timeline button{display:flex;align-items:center;gap:8px;white-space:nowrap;padding:9px 12px;border:1px solid var(--line);border-radius:12px;font-size:11px}.wi-timeline button.on{background:var(--pink-bg);border-color:var(--pink-line)}.wi-timeline span{color:var(--muted)}.wi-timeline .wi-current{color:var(--pink-deep)}.wi-record{border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0}.wi-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px}.wi-heading span,.wi-heading time{font-size:11px;color:var(--text2)}.wi-heading time{margin-left:auto}.wi-images{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.wi-images figure{margin:0;min-width:0}.wi-images img,.wi-no-image{width:100%;height:220px;object-fit:contain;background:var(--panel);border-radius:10px}.wi-no-image{display:grid;place-items:center;color:var(--muted);font-size:12px}.wi-images figcaption{text-align:center;font-size:11px;color:var(--text2);padding-top:6px}.wi-change{margin:18px 0}.wi-change label{display:block;margin-bottom:8px;font-size:12px;font-weight:600}.wi-change :deep(.diff-row){margin:6px 0}.wi-change p{font-size:12px;color:var(--text2)}.wi-params{width:100%;border-collapse:collapse;font-size:12px;margin:16px 0;text-align:left}.wi-params th,.wi-params td{padding:8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.wi-params th{font-weight:500}.wi-params thead{color:var(--text2)}.wi-mask,.wi-settings{margin-top:16px;font-size:12px}.wi summary{cursor:pointer;color:var(--text2)}.wi-mask img{display:block;max-width:100%;height:160px;margin-top:10px}.wi-mask p{white-space:pre-wrap}.wi-settings pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;max-height:260px;overflow:auto}.wi-settings dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px}.wi-settings dd{margin:0}.wi-start{padding:12px 0}
</style>
