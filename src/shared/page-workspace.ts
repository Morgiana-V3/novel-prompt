import type { InpaintChange, InpaintDraft, NaiGenParams, NaiImage, NaiVersion } from './types'

export interface PageRegion {
  id: string
  label: string
  instruction: string
  target: number | null
  anchor: { x: number; y: number } | null
  annotated: boolean
  mask: string
  accepted: InpaintDraft | null
}
export interface PageEditorState {
  model?: NaiVersion
  draft: InpaintDraft
  regions: PageRegion[]
  params: NaiGenParams
  strength: number
}
export interface PageVersion {
  id: string
  parentId: string | null
  label: string
  image: NaiImage | null
  imageCleared?: boolean
  createdAt: number
  /** Each candidate keeps its stable id; groupId identifies a generation scheme. */
  groupId?: string
  groupNumber?: number
  candidateNumber?: number
  schemeKey?: string
  editor: PageEditorState
  /** Immutable starting draft/settings; not a claim about imported image generation parameters. */
  initial?: { model?: NaiVersion; draft: InpaintDraft; params: NaiGenParams }
  generated?: { model?: NaiVersion; draft: InpaintDraft; params: NaiGenParams; execution: PageExecution; sourceVersionId: string; inpaint?: { mask: string; strength: number; label?: string; instruction?: string; target?: number | null } }
}
export interface PageExecution { kind: 'generate' | 'inpaint'; regionId: string | null }
/** The observed image/recipe is frozen independently of the editable target. */
export interface PageDiscussion {
  versionId: string
  label: string
  image: NaiImage | null
  recipe: { source: 'generated' | 'initial'; draft: InpaintDraft; params: NaiGenParams } | null
}
export interface PageAgentIdentity { sessionId: string; name: string }
export interface PageExternalReply {
  requestId: string
  reply: string
  understanding?: { goal: string; preserve: string } | null
  proposal?: { title: string; warning: string; draft: InpaintDraft; execution: PageExecution } | null
}
export interface PageProposal {
  regionId: string | null
  title: string
  warning: string
  changes: InpaintChange[]
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  superseded?: boolean
  /** Guards bind suggestions to the exact page, draft and selection they saw. */
  contextKey: string
  before: InpaintDraft
  previousAccepted: InpaintDraft | null
  previousRegions?: { id: string; accepted: InpaintDraft | null }[]
  appliedContextKey?: string
  after?: InpaintDraft
  execution?: PageExecution
  previousExecution?: PageExecution
  previousTargets?: { id: string; target: number | null }[]
}
export interface PageMessage {
  id: string
  role: 'user' | 'assistant' | 'event'
  text: string
  createdAt: number
  versionId: string
  regionId?: string | null
  referenceIds?: string[]
  discussion?: PageDiscussion
  proposal?: PageProposal
  /** Replaced suggestions retain only a chat receipt; each version owns one latest proposal. */
  proposalSummary?: { title: string; status: PageProposal['status'] }
  error?: boolean
  draftBefore?: InpaintDraft
  draftAfter?: InpaintDraft
  skills?: string[]
  author?: { kind: 'internal' | 'external'; name: string }
  requestId?: string
  externalRequest?: { status: 'pending' | 'completed' | 'cancelled'; contextKey: string }
  skillSnapshot?: { digest: string; text: string }
}
export interface PageWorkspace {
  schema: 1 | 2
  id: string
  title: string
  goal: string
  preserve: string
  model: NaiVersion
  createdAt: number
  updatedAt: number
  revision: number
  currentVersionId: string
  latestGeneratedVersionId?: string
  versions: PageVersion[]
  messages: PageMessage[]
  composer: string
  execution: PageExecution
  agentMode?: 'internal' | 'external'
  externalAgent?: PageAgentIdentity | null
}

export function pageGroups(w: PageWorkspace) {
  const groups: { id: string; label: string; versions: PageVersion[] }[] = []
  for (const v of w.versions) {
    const id = v.groupId ?? v.id
    let group = groups.find(g => g.id === id)
    if (!group) { group = { id, label: v.groupNumber ? `方案 V${v.groupNumber}` : v.label, versions: [] }; groups.push(group) }
    group.versions.push(v)
  }
  return groups
}
export interface PageWorkspaceSummary {
  id: string; title: string; updatedAt: number; image: NaiImage | null; versions: number; messages: number
}
export type PageAction =
  | { type: 'recipe'; request: import('./types').NaiGenRequest }
  | { type: 'notes'; title: string; goal: string; preserve: string; composer: string }
  | { type: 'editor'; versionId: string; editor: PageEditorState }
  | { type: 'switch'; versionId: string }
  | { type: 'proposal'; messageId: string; decision: 'accept' | 'reject' | 'undo' }
  | { type: 'execution'; execution: PageExecution }

export function pageCurrent(w: PageWorkspace): PageVersion {
  const v = w.versions.find(v => v.id === w.currentVersionId)
  if (!v) throw new Error('当前版本不存在')
  return v
}
export function pageLatestProposal(w: PageWorkspace, versionId: string): PageMessage | undefined {
  return w.messages.slice().reverse().find(m => m.versionId === versionId && m.proposal)
}
export function compactPageProposals(w: PageWorkspace): boolean {
  const seen = new Set<string>()
  let changed = false
  for (let i = w.messages.length - 1; i >= 0; i--) {
    const m = w.messages[i]
    if (!m.proposal) continue
    if (seen.has(m.versionId)) {
      if (!m.proposal.superseded) { m.proposal.superseded = true; changed = true }
    } else seen.add(m.versionId)
  }
  return changed
}
/** Never compare against an editable parent draft: it may already contain the next iteration. */
export function pageIteration(w: PageWorkspace, id: string) {
  const version = w.versions.find(v => v.id === id)
  const result = version?.generated
  const source = w.versions.find(v => v.id === (result?.sourceVersionId ?? version?.parentId))
  const before = source?.generated ?? source?.initial
  return { version, result, source, before, changes: result && before ? pageChanges(before.draft, result.draft) : [] }
}
/** A comparison is a read-only reference; it never changes the viewed or adopted candidate. */
export function pageComparison(w: PageWorkspace, id: string, compareId?: string) {
  const iteration = pageIteration(w, id)
  if (!iteration.version) throw new Error('查看版本不存在')
  const source = compareId ? w.versions.find(v => v.id === compareId) : iteration.source
  if (compareId && (!source || compareId === id)) throw new Error('请选择另一个有效的对比版本')
  const result = iteration.version.generated ?? iteration.version.initial
  const before = source?.generated ?? source?.initial
  return { ...iteration, source, before, snapshot: result,
    changes: result && before ? pageChanges(before.draft, result.draft) : [] }
}
/** Only differing generation settings; missing legacy snapshots are not equality. */
export function pageConfigurationChanges(w: PageWorkspace, id: string, compareId?: string) {
  const c = pageComparison(w, id, compareId)
  if (!c.before || !c.snapshot) return { ...c, parameters: [], maskChanged: false }
  const fields: [keyof NaiGenParams, string][] = [['width','宽度'],['height','高度'],['steps','步数'],['scale','Prompt Guidance'],['cfgRescale','Guidance Rescale'],['sampler','采样器'],['noiseSchedule','噪声调度'],['seed','种子'],['count','张数'],['qualityTags','Add Quality Tags'],['ucPreset','UC 预设']]
  const parameters: {label:string;before:unknown;after:unknown}[] = fields.filter(([key])=>c.before!.params[key]!==c.snapshot!.params[key])
    .map(([key,label])=>({label,before:c.before!.params[key],after:c.snapshot!.params[key]}))
  const add = (label:string,before:unknown,after:unknown) => { if(before!==after)parameters.push({label,before,after}) }
  add('模型',c.before.model,c.snapshot.model)
  const a=c.source?.generated, b=c.version?.generated
  if(a && b) add('生成方式',a.execution.kind,b.execution.kind)
  add('重绘强度',a?.inpaint?.strength,b?.inpaint?.strength)
  add('区域批注',a?.inpaint?.instruction,b?.inpaint?.instruction)
  add('区域对应角色',a?.inpaint?.target,b?.inpaint?.target)
  return { ...c, parameters, maskChanged: a?.inpaint?.mask !== b?.inpaint?.mask }
}
export function pageDraft(v: PageVersion, regionId: string | null): InpaintDraft {
  return v.editor.draft
}
/** Serializable on both sides; no model-generated digest is trusted. */
export function pageContextKey(v: PageVersion, regionId: string | null, notes?: Pick<PageWorkspace, 'goal' | 'preserve'> & { execution?: PageExecution; model?: NaiVersion }): string {
  return JSON.stringify([v.id, pageDraft(v, regionId), v.editor.params, v.editor.strength, v.editor.regions.map(r => [r.id, r.mask, r.instruction, r.target]), notes?.goal, notes?.preserve, notes?.execution, notes?.model])
}

export function pageChanges(before: InpaintDraft, after: InpaintDraft): InpaintChange[] {
  const changes: InpaintChange[] = []
  for (const field of ['base', 'negative'] as const) if (before[field] !== after[field]) changes.push({ field, before: before[field], after: after[field], reason: '' })
  for (let i = 0; i < Math.max(before.characters.length, after.characters.length); i++) {
    const a = before.characters[i], b = after.characters[i]
    for (const [key, field] of [['prompt', 'character'], ['negative', 'characterNegative']] as const) {
      if ((a?.[key] ?? '') !== (b?.[key] ?? '')) changes.push({ field, characterIndex: i, before: a?.[key] ?? '', after: b?.[key] ?? '', reason: !a ? '新增角色' : !b ? '移除角色' : '' })
    }
    if ((a?.position ?? '') !== (b?.position ?? '')) changes.push({ field: 'character', characterIndex: i, before: '', after: '', reason: `位置：${a?.position || '自动'} → ${b?.position || '自动'}` })
  }
  return changes
}
