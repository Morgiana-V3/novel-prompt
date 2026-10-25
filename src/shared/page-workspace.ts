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
  createdAt: number
  editor: PageEditorState
  generated?: { draft: InpaintDraft; params: NaiGenParams; execution: PageExecution; sourceVersionId: string; inpaint?: { mask: string; strength: number } }
}
export interface PageExecution { kind: 'generate' | 'inpaint'; regionId: string | null }
export interface PageProposal {
  regionId: string | null
  title: string
  warning: string
  changes: InpaintChange[]
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
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
  proposal?: PageProposal
  error?: boolean
  draftBefore?: InpaintDraft
  draftAfter?: InpaintDraft
  skills?: string[]
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
  versions: PageVersion[]
  messages: PageMessage[]
  composer: string
  execution: PageExecution
}
export interface PageWorkspaceSummary {
  id: string; title: string; updatedAt: number; image: NaiImage | null; versions: number; messages: number
}
export type PageAction =
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
export function pageDraft(v: PageVersion, regionId: string | null): InpaintDraft {
  return v.editor.draft
}
/** Serializable on both sides; no model-generated digest is trusted. */
export function pageContextKey(v: PageVersion, regionId: string | null, notes?: Pick<PageWorkspace, 'goal' | 'preserve'> & { execution?: PageExecution }): string {
  return JSON.stringify([v.id, pageDraft(v, regionId), v.editor.params, v.editor.strength, v.editor.regions.map(r => [r.id, r.mask, r.instruction, r.target]), notes?.goal, notes?.preserve, notes?.execution])
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
