import { createHash } from 'node:crypto'
import { currentAgent } from '../agent-sessions'
import type { PageSkillSnapshot, PageSkillSection } from '../../shared/page-workspace'

const delivered = new WeakMap<object, { bodies: Set<string>; manifests: Map<string, { digest: string; ids: string[] }> }>()
const scopes: Record<string, string[]> = { overview: [], prompt: ['all', 'optimize'], preview: ['all', 'preview'], inpaint: ['all', 'optimize', 'inpaint'], all: ['all', 'optimize', 'preview', 'inpaint'] }
export const SKILLS_READ_SCHEMA = {
  skills_task: { type: 'string', enum: Object.keys(scopes), description: '默认 overview 只读总则和目录；prompt 编写提示词，preview 分析画面，inpaint 重绘，all 全部。相关 scope=all 用户规则随任务必读。' },
  skills_ids: { type: 'array', items: { type: 'string' }, maxItems: 100, description: '额外读取本轮冻结目录里的篇目 id；总则始终选中。' },
  skills_digests: { type: 'object', additionalProperties: { type: 'string' }, description: '客户端实际保留的正文指纹表 {篇目id: digest}。提供时取代连接缓存判断；目录指纹不能当作正文已读。' },
  skills_mode: { type: 'string', enum: ['auto', 'full', 'metadata'], description: 'auto 仅返回所选篇目中未读或变化的正文；full 强制重读所选篇目；metadata 只看目录，不标记已读。' },
  rules_only: { type: 'boolean', description: '只返回项目/请求标识及冻结规则，省略图片、参数和候选列表。' }
}
export function contextSkills(snapshot: PageSkillSnapshot | undefined, args: Record<string, unknown>) {
  if (!snapshot) return null
  const agent = currentAgent(), mode = args.skills_mode ?? 'auto', task = String(args.skills_task ?? 'overview')
  if (!Object.hasOwn(scopes, task)) throw Error('未知规则任务类型')
  const state = agent ? delivered.get(agent) ?? { bodies: new Set<string>(), manifests: new Map<string, { digest: string; ids: string[] }>() } : { bodies: new Set<string>(), manifests: new Map<string, { digest: string; ids: string[] }>() }
  // An opaque frozen document must remain intact. Never substitute today's rules
  // or guess boundaries from user-controlled markup inside its text.
  const sections: PageSkillSection[] = snapshot.sections ?? [{ id: 'snapshot', name: '冻结规则原文', description: '未提供分段索引，按原文完整读取', scope: 'core', model: 'all', priority: 0, start: 0, end: snapshot.text.length, digest: snapshot.digest }]
  if (!sections.length || new Set(sections.map(s => s.id)).size !== sections.length || !sections.some(s => s.scope === 'core')
    || sections.some(s => !['core', 'all', 'optimize', 'preview', 'inpaint'].includes(s.scope) || !Number.isInteger(s.priority) || s.priority < 0
      || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end < s.start || s.end > snapshot.text.length
      || createHash('sha256').update(snapshot.text.slice(s.start, s.end)).digest('hex') !== s.digest)) throw Error('冻结规则索引无效，无法安全按篇读取')
  const requested = args.skills_ids as string[] | undefined
  if (requested?.some(id => !sections.some(s => s.id === id))) throw Error('指定规则不在本轮冻结目录中，请重新读取目录')
  const supplied = args.skills_digests as Record<string, string> | undefined
  const known = (s: PageSkillSection) => supplied !== undefined ? supplied[s.id] === s.digest : state.bodies.has(`${s.id}:${s.digest}`)
  const selected = sections.filter(s => s.scope === 'core' || scopes[task].includes(s.scope) || requested?.includes(s.id))
  // Overview is discovery, not permission to bypass general user-authored rules.
  const required = sections.filter(s => s.scope === 'core' || s.scope === 'all' || scopes[task].includes(s.scope) || requested?.includes(s.id))
  const bodies = selected.filter(s => mode !== 'metadata' && (mode === 'full' || !known(s)))
  const key = String(args.id ?? 'current'), previous = state.manifests.get(key)
  const removedIds = [...new Set([...(previous?.ids ?? []), ...Object.keys(supplied ?? {})])].filter(id => !sections.some(s => s.id === id))
  const missingRequiredIds = required.filter(s => !known(s) && !bodies.includes(s)).map(s => s.id)
  const bodiesNotModified = bodies.length === 0 && selected.every(known)
  if (agent) {
    for (const s of bodies) state.bodies.add(`${s.id}:${s.digest}`)
    while (state.bodies.size > 256) state.bodies.delete(state.bodies.values().next().value!)
    state.manifests.set(key, { digest: snapshot.digest, ids: sections.map(s => s.id) })
    while (state.manifests.size > 32) state.manifests.delete(state.manifests.keys().next().value!)
    delivered.set(agent, state)
  }
  return { digest: snapshot.digest, textLength: snapshot.text.length, task, segmented: !!snapshot.sections,
    manifestChanged: previous?.digest !== snapshot.digest, removedIds,
    manifest: sections.map(({ start, end, ...s }) => ({ ...s, textLength: end - start, selected: selected.some(p => p.id === s.id), required: required.some(p => p.id === s.id) })),
    sections: bodies.map(s => ({ id: s.id, digest: s.digest, text: snapshot.text.slice(s.start, s.end) })),
    selectedIds: selected.map(s => s.id), requiredIds: required.map(s => s.id), missingRequiredIds,
    bodiesNotModified, selectionComplete: missingRequiredIds.length === 0,
    nextAction: task === 'overview' ? '已返回总则和目录。按本轮任务选择 skills_task，必要时用 skills_ids 补读；不要将目录当成完整规则。'
      : missingRequiredIds.length ? '先补读 missingRequiredIds 中的规则，再执行本轮任务。'
      : '按目录中的最新优先级应用正文；若正文已不在当前上下文，传 skills_mode:full 重读所选篇目。' }
}
