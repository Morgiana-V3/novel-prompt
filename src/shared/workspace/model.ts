import type { NaiGenParams, NaiGenRequest, NaiVersion } from '../generation/types'
import type { NaiImage } from '../images/types'
import type { InpaintChange, InpaintDraft } from '../prompts/types'

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
  generated?: {
    model?: NaiVersion
    draft: InpaintDraft
    params: NaiGenParams
    execution: PageExecution
    sourceVersionId: string
    inpaint?: {
      mask: string
      strength: number
      label?: string
      instruction?: string
      target?: number | null
      regions?: Pick<PageRegion, 'id' | 'label' | 'instruction' | 'target'>[]
    }
  }
}
export interface PageExecution {
  kind: 'generate' | 'inpaint'
  regionId: string | null
  regionIds?: string[]
}
/** The observed image/recipe is frozen independently of the editable target. */
export interface PageDiscussion {
  versionId: string
  label: string
  image: NaiImage | null
  recipe: { source: 'generated' | 'initial'; draft: InpaintDraft; params: NaiGenParams } | null
}
export interface PageAgentActivity {
  workspaceId: string
  requestId: string
  message: string
  expiresAt: number
}
export interface PageAgentIdentity {
  sessionId: string
  name: string
  activity?: PageAgentActivity[]
}
export interface PageExternalReply {
  requestId: string
  reply: string
  understanding?: { goal: string; preserve: string } | null
  proposal?: {
    title: string
    warning: string
    draft: InpaintDraft
    execution: PageExecution
  } | null
}
export interface PageProposal {
  regionId: string | null
  regionIds?: string[]
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
export interface PageSkillSection {
  resourcePath?: string
  skillId?: string
  id: string
  name: string
  description: string
  scope: 'core' | 'all' | 'optimize' | 'preview' | 'inpaint'
  model: 'all' | 'v4.5' | 'v5'
  priority: number
  start: number
  end: number
  digest: string
}
export interface PageSkillSnapshot {
  digest: string
  text: string
  sections?: PageSkillSection[]
}
export interface PageMessage {
  /** 调度诊断只记录计数/耗时，不保存供应商凭据、思考正文或工具参数。 */
  toolUsage?: {
    modelRequests: number
    referenceRequests: number
    referenceFiles: number
    referenceCacheHits: number
    tagRequests: number
    tagExecuted: number
    tagCacheHits: number
    tagLimited: number
    elapsedMs: number
  }
  id: string
  role: 'user' | 'assistant' | 'event'
  text: string
  createdAt: number
  versionId: string
  regionId?: string | null
  regionIds?: string[]
  regions?: Pick<PageRegion, 'id' | 'label' | 'instruction' | 'target'>[]
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
  skillSnapshot?: PageSkillSnapshot
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

function characterChangeReason(before: unknown, after: unknown) {
  if (!before) {
    return '新增角色'
  }
  if (!after) {
    return '移除角色'
  }
  return ''
}
export function pageGroups(workspace: PageWorkspace) {
  const groups: { id: string; label: string; versions: PageVersion[] }[] = []
  for (const version of workspace.versions) {
    const id = version.groupId ?? version.id
    let group = groups.find((versionGroup) => versionGroup.id === id)
    if (!group) {
      group = {
        id,
        label: version.groupNumber ? `方案 V${version.groupNumber}` : version.label,
        versions: [],
      }
      groups.push(group)
    }
    group.versions.push(version)
  }
  return groups
}
export interface PageWorkspaceSummary {
  id: string
  title: string
  updatedAt: number
  image: NaiImage | null
  versions: number
  messages: number
}
export type PageAction =
  | { type: 'recipe'; request: NaiGenRequest }
  | { type: 'notes'; title: string; goal: string; preserve: string; composer: string }
  | { type: 'editor'; versionId: string; editor: PageEditorState }
  | { type: 'switch'; versionId: string }
  | { type: 'proposal'; messageId: string; decision: 'accept' | 'reject' | 'undo' }
  | { type: 'execution'; execution: PageExecution }

export function pageCurrent(workspace: PageWorkspace): PageVersion {
  const version = workspace.versions.find((version2) => version2.id === workspace.currentVersionId)
  if (!version) {
    throw new Error('当前版本不存在')
  }
  return version
}
export function pageLatestProposal(
  workspace: PageWorkspace,
  versionId: string,
): PageMessage | undefined {
  return workspace.messages
    .slice()
    .reverse()
    .find((message) => message.versionId === versionId && message.proposal)
}
export function compactPageProposals(workspace: PageWorkspace): boolean {
  const seen = new Set<string>()
  let changed = false
  for (let i = workspace.messages.length - 1; i >= 0; i--) {
    const message = workspace.messages[i]
    if (!message.proposal) {
      continue
    }
    if (seen.has(message.versionId)) {
      if (!message.proposal.superseded) {
        message.proposal.superseded = true
        changed = true
      }
    } else {
      seen.add(message.versionId)
    }
  }
  return changed
}
/** Never compare against an editable parent draft: it may already contain the next iteration. */
export function pageIteration(workspace: PageWorkspace, id: string) {
  const version = workspace.versions.find((version2) => version2.id === id)
  const result = version?.generated
  const source = workspace.versions.find(
    (version2) => version2.id === (result?.sourceVersionId ?? version?.parentId),
  )
  const before = source?.generated ?? source?.initial
  return {
    version,
    result,
    source,
    before,
    changes: result && before ? pageChanges(before.draft, result.draft) : [],
  }
}
/** A comparison is a read-only reference; it never changes the viewed or adopted candidate. */
export function pageComparison(workspace: PageWorkspace, id: string, compareId?: string) {
  const iteration = pageIteration(workspace, id)
  if (!iteration.version) {
    throw new Error('查看版本不存在')
  }
  const source = compareId
    ? workspace.versions.find((version) => version.id === compareId)
    : iteration.source
  if (compareId && (!source || compareId === id)) {
    throw new Error('请选择另一个有效的对比版本')
  }
  const result = iteration.version.generated ?? iteration.version.initial
  const before = source?.generated ?? source?.initial
  return {
    ...iteration,
    source,
    before,
    snapshot: result,
    changes: result && before ? pageChanges(before.draft, result.draft) : [],
  }
}
/** Only differing generation settings; missing legacy snapshots are not equality. */
export function pageConfigurationChanges(workspace: PageWorkspace, id: string, compareId?: string) {
  const comparison = pageComparison(workspace, id, compareId)
  if (!comparison.before || !comparison.snapshot) {
    return { ...comparison, parameters: [], maskChanged: false }
  }
  const fields: [keyof NaiGenParams, string][] = [
    ['width', '宽度'],
    ['height', '高度'],
    ['steps', '步数'],
    ['scale', 'Prompt Guidance'],
    ['cfgRescale', 'Guidance Rescale'],
    ['sampler', '采样器'],
    ['noiseSchedule', '噪声调度'],
    ['seed', '种子'],
    ['count', '张数'],
    ['qualityTags', 'Add Quality Tags'],
    ['ucPreset', 'UC 预设'],
  ]
  const parameters: { label: string; before: unknown; after: unknown }[] = fields
    .filter(([key]) => comparison.before!.params[key] !== comparison.snapshot!.params[key])
    .map(([key, label]) => ({
      label,
      before: comparison.before!.params[key],
      after: comparison.snapshot!.params[key],
    }))
  const add = (label: string, before: unknown, after: unknown) => {
    if (before !== after) {
      parameters.push({ label, before, after })
    }
  }
  add('模型', comparison.before.model, comparison.snapshot.model)
  const sourceGeneration = comparison.source?.generated
  const resultGeneration = comparison.version?.generated
  if (sourceGeneration && resultGeneration) {
    add('生成方式', sourceGeneration.execution.kind, resultGeneration.execution.kind)
  }
  add('重绘强度', sourceGeneration?.inpaint?.strength, resultGeneration?.inpaint?.strength)
  add('区域批注', sourceGeneration?.inpaint?.instruction, resultGeneration?.inpaint?.instruction)
  add('区域对应角色', sourceGeneration?.inpaint?.target, resultGeneration?.inpaint?.target)
  return {
    ...comparison,
    parameters,
    maskChanged: sourceGeneration?.inpaint?.mask !== resultGeneration?.inpaint?.mask,
  }
}
export function pageDraft(version: PageVersion, _regionId: string | null): InpaintDraft {
  return version.editor.draft
}
/** Serializable on both sides; no model-generated digest is trusted. */
export function pageContextKey(
  version: PageVersion,
  regionId: string | string[] | null,
  notes?: Pick<PageWorkspace, 'goal' | 'preserve'> & {
    execution?: PageExecution
    model?: NaiVersion
  },
): string {
  return JSON.stringify([
    version.id,
    pageDraft(version, null),
    version.editor.params,
    version.editor.strength,
    version.editor.regions.map((region) => [
      region.id,
      region.mask,
      region.instruction,
      region.target,
    ]),
    notes?.goal,
    notes?.preserve,
    notes?.execution,
    notes?.model,
    ...(Array.isArray(regionId) && regionId.length > 1 ? [regionId.slice().sort()] : []),
  ])
}

export function pageChanges(before: InpaintDraft, after: InpaintDraft): InpaintChange[] {
  const changes: InpaintChange[] = []
  for (const field of ['base', 'negative'] as const) {
    if (before[field] !== after[field]) {
      changes.push({ field, before: before[field], after: after[field], reason: '' })
    }
  }
  for (let i = 0; i < Math.max(before.characters.length, after.characters.length); i++) {
    const character = before.characters[i]
    const character2 = after.characters[i]
    for (const [key, field] of [
      ['prompt', 'character'],
      ['negative', 'characterNegative'],
    ] as const) {
      if ((character?.[key] ?? '') !== (character2?.[key] ?? '')) {
        changes.push({
          field,
          characterIndex: i,
          before: character?.[key] ?? '',
          after: character2?.[key] ?? '',
          reason: characterChangeReason(character, character2),
        })
      }
    }
    if ((character?.position ?? '') !== (character2?.position ?? '')) {
      changes.push({
        field: 'character',
        characterIndex: i,
        before: '',
        after: '',
        reason: `位置：${character?.position || '自动'} → ${character2?.position || '自动'}`,
      })
    }
  }
  return changes
}
