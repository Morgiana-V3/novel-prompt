<script setup lang="ts">
import { computed } from 'vue'
import { pageIteration, type PageWorkspace } from '@shared/page-workspace'
import type { NaiGenParams } from '@shared/types'
import { changeLabel } from '@shared/inpaint-plan'
import { diffPrompt } from '../prompt-diff'
import DiffChips from './DiffChips.vue'

const props = defineProps<{ work: PageWorkspace; versionId: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const iteration = computed(() => pageIteration(props.work, props.versionId))
const records = computed(() => props.work.versions.filter(v => v.generated || !v.parentId).slice().reverse())
function name(id: string) {
  const i = props.work.versions.findIndex(v => v.id === id)
  return i === 0 ? (props.work.versions[0].image ? '原稿' : '起点') : `版本 ${i}`
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
      <button v-for="v in records" :key="v.id" :class="{on:v.id===versionId}" @click="emit('select',v.id)">
        <b>{{ name(v.id) }}</b><span>{{ v.generated ? (v.generated.execution.kind==='inpaint'?'局部重绘':'提示词生图') : '会话起点' }}</span><span v-if="v.id===work.currentVersionId" class="wi-current">当前</span>
      </button>
    </nav>
    <article v-if="iteration.result" class="wi-record">
      <div class="wi-heading"><b>{{ iteration.source ? name(iteration.source.id) : '来源版本' }} → {{ name(versionId) }}</b><span>{{ iteration.result.execution.kind==='inpaint'?'局部重绘':'提示词生图' }}</span><time>{{ new Date(iteration.version!.createdAt).toLocaleString('zh-CN') }}</time></div>
      <div class="wi-images">
        <figure><img v-if="iteration.source?.image" :src="iteration.source.image.url" alt="上一版"><div v-else class="wi-no-image">无基础图片</div><figcaption>修改前</figcaption></figure>
        <figure><img v-if="iteration.version?.image" :src="iteration.version.image.url" alt="本轮结果"><figcaption>本轮结果</figcaption></figure>
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
