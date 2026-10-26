<script setup lang="ts">
import { computed } from 'vue'
import { pageConfigurationChanges, type PageWorkspace } from '@shared/page-workspace'
import { changeLabel } from '@shared/inpaint-plan'
import { diffPrompt } from '../prompt-diff'
import DiffChips from './DiffChips.vue'

const props = defineProps<{ work: PageWorkspace; versionId: string; compareId: string }>()
const iteration = computed(() => pageConfigurationChanges(props.work, props.versionId, props.compareId))
function name(id: string) {
  const i = props.work.versions.findIndex(v => v.id === id)
  return props.work.versions[i]?.label ?? '历史版本'
}
function value(v: unknown, label: string) {
  if(v === undefined) return '无 / 未记录'
  if(v === null) return label==='种子' ? '随机' : label==='区域对应角色' ? '全局' : '未指定'
  if(label==='区域对应角色' && typeof v==='number') return `角色 ${v+1}`
  return typeof v === 'boolean' ? (v?'开':'关') : v === 'generate' ? '整图生成' : v === 'inpaint' ? '局部重绘' : String(v)
}
const parameters = computed(() => iteration.value.parameters.map(p=>({...p,before:value(p.before,p.label),after:value(p.after,p.label)})))
const maskUrl = computed(() => {
  const mask = iteration.value.result?.inpaint?.mask
  return mask ? (mask.startsWith('data:') ? mask : `data:image/png;base64,${mask}`) : ''
})
</script>

<template>
  <section class="wi">
    <article class="wi-record">
      <div class="wi-images">
        <figure><img v-if="iteration.source?.image && !iteration.source.image.missing" :src="iteration.source.image.url" @error="iteration.source.image.missing=true" alt="对比图片"><div v-else class="wi-no-image">{{ iteration.source?.image ? '图片缺失 · 文字记录保留' : '无来源图片，可指定对比对象' }}</div><figcaption>对比对象{{ iteration.source ? ' · '+name(iteration.source.id) : '' }}</figcaption></figure>
        <figure><img v-if="iteration.version?.image && !iteration.version.image.missing" :src="iteration.version.image.url" @error="iteration.version.image.missing=true" alt="正在查看的图片"><div v-else class="wi-no-image">{{ iteration.version?.image ? '图片缺失 · 文字记录保留' : '暂无图片' }}</div><figcaption>正在查看 · {{ name(versionId) }}</figcaption></figure>
      </div>
      <p v-if="!iteration.before" class="muted small">尚无可用的对比快照，可选择其他版本作为对比对象。</p>
      <p v-else-if="!iteration.snapshot" class="muted small">此版本未保存生成快照，仅能查看图片与历史草稿。</p>
      <p v-else-if="!iteration.source?.generated" class="muted small">对比对象为项目起始稿与设置，不代表导入图片的实际生成参数。</p>
      <div v-for="(c,i) in iteration.changes" :key="i" class="wi-change"><label>{{ changeLabel(c) }}</label><DiffChips :diff="diffPrompt(c.before,c.after)"/><p v-if="c.reason">{{ c.reason }}</p></div>
      <p v-if="iteration.before&&iteration.snapshot&&!iteration.changes.length&&!parameters.length&&!iteration.maskChanged" class="muted small">生图配置无差异</p>
      <table v-if="parameters.length && iteration.before" class="wi-params"><thead><tr><th>参数</th><th>对比对象</th><th>正在查看</th></tr></thead><tbody><tr v-for="p in parameters" :key="p.label"><th>{{ p.label }}</th><td>{{ p.before }}</td><td>{{ p.after }}</td></tr></tbody></table>
      <p v-if="iteration.maskChanged && !iteration.result?.inpaint" class="muted small">此版本不再使用重绘遮罩。</p>
      <details v-if="iteration.maskChanged && iteration.result?.inpaint" class="wi-mask"><summary>重绘区域已变更{{ iteration.result.inpaint.label ? ` · ${iteration.result.inpaint.label}` : '' }}</summary><img :src="maskUrl" alt="本轮遮罩，白色为重绘区域"><p v-if="iteration.result.inpaint.instruction">{{ iteration.result.inpaint.instruction }}</p><p>重绘强度 {{ iteration.result.inpaint.strength }}<template v-if="iteration.result.inpaint.target != null"> · 角色 {{ iteration.result.inpaint.target+1 }}</template></p></details>

    </article>

  </section>
</template>

<style scoped>
.wi-compare{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}.wi-compare label{display:flex;align-items:center;gap:8px}.wi-compare :deep(.theme-select){max-width:260px}

.wi{margin:16px 0 24px;min-width:0}.wi-record{border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0}.wi-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px}.wi-heading span,.wi-heading time{font-size:11px;color:var(--text2)}.wi-heading time{margin-left:auto}.wi-images{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.wi-images figure{margin:0;min-width:0}.wi-images img,.wi-no-image{width:100%;height:220px;object-fit:contain;background:var(--panel);border-radius:10px}.wi-no-image{display:grid;place-items:center;color:var(--muted);font-size:12px}.wi-images figcaption{text-align:center;font-size:11px;color:var(--text2);padding-top:6px}.wi-change{margin:18px 0}.wi-change label{display:block;margin-bottom:8px;font-size:12px;font-weight:600}.wi-change :deep(.diff-row){margin:6px 0}.wi-change p{font-size:12px;color:var(--text2)}.wi-params{width:100%;border-collapse:collapse;font-size:12px;margin:16px 0;text-align:left}.wi-params th,.wi-params td{padding:8px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.wi-params th{font-weight:500}.wi-params thead{color:var(--text2)}.wi-mask{margin-top:16px;font-size:12px}.wi summary{cursor:pointer;color:var(--text2)}.wi-mask img{display:block;max-width:100%;height:160px;margin-top:10px}.wi-mask p{white-space:pre-wrap}.wi-start{padding:12px 0}
.wi{margin:0 0 20px}.wi-record{border:0;padding:0}.wi-images{margin:0 0 16px}
</style>
