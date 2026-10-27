import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync, existsSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dataDir } from './paths'
import { writeFileAtomic } from './fs-safe'
import { imageDir, imagePath } from './nai/client'
import { imageInfo, ownWorkspaceImage, restoreImageFile, readImageRecipe } from './image-library'
import { workspaceImageNames } from './workspace-image-references'
import { pngSize } from './nai/zip'
import { PNG } from 'pngjs'
import { prepareInpaint } from './nai/inpaint'
import { readPngPrompt } from '../shared/prompt-import'
import { applyInpaintChanges } from '../shared/inpaint-plan'
import { compactPageProposals, pageChanges, pageContextKey, pageCurrent, pageDraft, type PageAction, type PageEditorState, type PageMessage, type PageWorkspace, type PageWorkspaceSummary } from '../shared/page-workspace'
import { MAX_CHARACTERS, parsePosition, isGridPosition } from '../shared/nai-presets'
import type { InpaintDraft, NaiGenParams, NaiVersion } from '../shared/types'
import type { PageAgentIdentity, PageExternalReply, PageDiscussion } from '../shared/page-workspace'
import { agentIsConnected } from './agent-sessions'
import { composeSkills } from './skills'

const directory = () => { const p = join(dataDir(), 'page-workspaces'); mkdirSync(p, { recursive: true }); return p }
function file(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的工作区标识')
  return join(directory(), `${id}.json`)
}
export const pageLocks = new Map<string, AbortController>()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
type PendingPageSummary = { id: string; title: string; revision: number; requestId: string; agent: PageWorkspace['externalAgent']; discussionVersionId: string; editVersionId: string | null; stale: boolean }
type PageAccess = Pick<PageWorkspace, 'id' | 'revision' | 'agentMode' | 'externalAgent' | 'currentVersionId' | 'execution'>
type PageIndexEntry = { signature: string; stamp: string; summary: PageWorkspaceSummary; access: PageAccess; pending: PendingPageSummary | null; images: [string, string | null][] }
// Derived, bounded metadata only. Files remain authoritative; no masks or history bodies are retained.
const pageIndex = new Map<string, PageIndexEntry>()
const readIndexes = new WeakMap<PageWorkspace, PageIndexEntry>()
function fileSignature(path: string) {
  const s = statSync(path, { bigint: true })
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
}
function imageSignature(name: string): string | null {
  const path = imagePath(name)
  return path ? path + ':' + fileSignature(path) : null
}
function rememberPage(w: PageWorkspace, signature: string) {
  const path = file(w.id)
  const v = pageCurrent(w), request = pendingExternalRequest(w)
  const images: [string, string | null][] = [...new Set(w.versions.flatMap(v => v.image ? [v.image.name] : []))].map(name => [name, imageSignature(name)])
  const summary = clone({ id: w.id, title: w.title, updatedAt: w.updatedAt, image: v.image, versions: w.versions.length, messages: w.messages.filter(m => m.role === 'user').length })
  const pending = request ? clone({ id: w.id, title: w.title, revision: w.revision, requestId: request.id, agent: w.externalAgent,
    discussionVersionId: request.discussion?.versionId ?? request.versionId, editVersionId: request.versionId,
    stale: request.versionId !== v.id || request.externalRequest!.contextKey !== pageContextKey(v, request.regionId ?? null, w) || discussionIsStale(w, request.discussion) }) : null
  pageIndex.delete(path)
  const access = clone({ id: w.id, revision: w.revision, agentMode: w.agentMode, externalAgent: w.externalAgent, currentVersionId: w.currentVersionId, execution: w.execution })
  const entry = { signature, stamp: signature + JSON.stringify(images), summary, access, pending, images }
  readIndexes.set(w, entry)
  if (fileSignature(path) !== signature) return
  pageIndex.set(path, entry)
  while (pageIndex.size > 512) pageIndex.delete(pageIndex.keys().next().value!)
}
function cachedPageIndex(id: string) {
  const path = file(id), entry = pageIndex.get(path)
  if (!entry) return undefined
  try {
    if (fileSignature(path) === entry.signature && entry.images.every(([name, signature]) => imageSignature(name) === signature)) return entry
  } catch { /* Deleted/unreadable files must take the normal read/error path. */ }
  pageIndex.delete(path)
  return undefined
}
/** Only usable for a snapshot actually read from this unchanged file and image state. */
export function pageReadStamp(id: string): string | undefined { return cachedPageIndex(id)?.stamp }
export function readPageAccess(id: string): PageAccess {
  const path = file(id), entry = pageIndex.get(path)
  // Ownership/execution metadata depends only on the project file, not every
  // historical image. Keep frequent connection checks independent of gallery size.
  if (entry && fileSignature(path) === entry.signature) return clone(entry.access)
  return clone(readIndexes.get(readPage(id))!.access)
}
function indexedPages(): PageIndexEntry[] {
  const dir = directory(), names = readdirSync(dir).filter(n => n.endsWith('.json')), present = new Set(names.map(n => join(dir, n)))
  for (const path of pageIndex.keys()) if (!present.has(path)) pageIndex.delete(path)
  const entries: PageIndexEntry[] = []
  for (const name of names) {
    try {
      const id = name.slice(0, -5)
      let entry = cachedPageIndex(id)
      if (!entry) entry = readIndexes.get(readPage(id))
      if (entry) entries.push(entry)
    } catch (e) { console.error('读取创作会话失败', name, String(e)) }
  }
  return entries.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
}
export function listPendingPageRequests(): PendingPageSummary[] { return indexedPages().flatMap(e => e.pending ? [clone(e.pending)] : []) }
export function readPage(id: string): PageWorkspace {
  const path = file(id), signature = fileSignature(path)
  const w = JSON.parse(readFileSync(path, 'utf8')) as PageWorkspace
  if (![1, 2].includes(w.schema) || w.id !== id || !Array.isArray(w.versions) || !Array.isArray(w.messages)) throw new Error('工作区文件格式不受支持')
  pageCurrent(w)
  if (w.schema === 1) {
    w.schema = 2; w.execution = { kind: 'generate', regionId: null }
    const oldVersions = [...w.versions]
    for (const v of oldVersions) {
      for (const r of v.editor.regions.filter(r => r.accepted)) {
        const restored = { ...clone(v), id: randomUUID(), parentId: v.id, label: `${v.label} · 区域 ${r.label} 草稿（旧版）`, editor: { ...clone(v.editor), draft: clone(r.accepted!), regions: v.editor.regions.map(r => ({ ...r, accepted: null })) } }
        w.versions.push(restored)
      }
      v.editor.regions.forEach(r => { r.accepted = null })
    }
    if (w.title === '未命名漫画页') w.title = '未命名项目'
    pageEvent(w, '已升级为通用创作会话。旧版区域独立草稿保留在历史版本；请选择要继续使用的草稿。')
    savePage(w)
  }
  for (const v of w.versions) if (v.image) {
    const path = imagePath(v.image.name)
    v.image.missing = !path
    v.image.storage = 'workspace'
    if (path && !v.image.contentHash) v.image.contentHash = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  rememberPage(w, signature)
  return w
}
export function savePage(w: PageWorkspace): PageWorkspace {
  compactPageProposals(w)
  w.updatedAt = Date.now(); w.revision++
  const data = JSON.stringify(w)
  if (Buffer.byteLength(data) > 64 * 1024 * 1024) throw new Error('当前工作区超过 64 MB，请减少不再使用的选区')
  writeFileAtomic(file(w.id), data)
  pageIndex.delete(file(w.id))
  return w
}
export function listPages(): PageWorkspaceSummary[] {
  return indexedPages().map(e => clone(e.summary))
}
export function pageUsesImage(name: string): boolean {
  if (imageInfo(name)?.storage === 'workspace') return true
  return workspaceImageNames().has(name)
}
export function checkDraft(d: InpaintDraft, model: NaiVersion = 'v5') {
  if (!d || typeof d.base !== 'string' || typeof d.negative !== 'string' || !Array.isArray(d.characters) || d.characters.length > MAX_CHARACTERS[model]
    || [d.base, d.negative, ...d.characters.flatMap(c => [c.prompt, c.negative ?? '', c.position ?? ''])].some(t => typeof t !== 'string' || t.length > 30000)) throw new Error('提示词格式无效')
  if (d.characters.some(c => c.position?.trim() && (!parsePosition(c.position) || model === 'v4.5' && !isGridPosition(c.position)))) throw new Error('角色位置格式无效')
}
export function checkPageParams(p: NaiGenParams) {
  if(!p || ![1,2,4].includes(p.count) || typeof p.qualityTags!=='boolean' || !['heavy','light','human','none'].includes(p.ucPreset))throw new Error('张数或提示词预设无效')
  if (!p || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 64 || p.height < 64 || p.width % 64 || p.height % 64 || p.width * p.height > 4 * 1024 * 1024
    || !Number.isInteger(p.steps) || p.steps < 1 || p.steps > 50 || !Number.isFinite(p.scale) || p.scale < 0 || p.scale > 10
    || p.seed !== null && (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 4294967295)) throw new Error('生成参数无效：尺寸需为 64 的倍数，步数为 1–50，种子留空或为有效整数')
}
function checkEditor(editor: PageEditorState, imageName: string | undefined, allowMissingRegions = false) {
  checkDraft(editor.draft)
  checkPageParams(editor.params)
  if (!Number.isFinite(editor.params.cfgRescale) || editor.params.cfgRescale < 0 || editor.params.cfgRescale > 1
    || !['k_euler_ancestral','k_euler','k_dpmpp_2s_ancestral','k_dpmpp_2m_sde','k_dpmpp_2m','k_dpmpp_sde'].includes(editor.params.sampler)
    || !['native','karras','exponential','polyexponential'].includes(editor.params.noiseSchedule)) throw new Error('采样器、噪声调度或引导重缩放无效')
  if (!Array.isArray(editor.regions) || editor.regions.length > 16 || !Number.isFinite(editor.strength) || editor.strength < .01 || editor.strength > 1) throw new Error('选区或重绘强度无效')
  const image = imageName ? imagePath(imageName) : null
  if (!image && editor.regions.length && !allowMissingRegions) throw new Error('工作区图片不存在，不能修改遮罩；可加载历史设置后重新生成')
  const ids = new Set<string>()
  for (const r of editor.regions) {
    if (!r.id || ids.has(r.id) || typeof r.mask !== 'string' || r.mask.length > 8 * 1024 * 1024 || typeof r.instruction !== 'string' || r.instruction.length > 6000
      || !/^[A-Z]{2,16}$/.test(r.label) || (r.target !== null && (!Number.isInteger(r.target) || !editor.draft.characters[r.target]))) throw new Error('批注格式无效')
    ids.add(r.id)
    if (r.accepted) checkDraft(r.accepted)
    if (image) prepareInpaint(readFileSync(image), r.mask, editor.params.width, editor.params.height)
  }
}
export function pageEvent(w: PageWorkspace, text: string, versionId = w.currentVersionId): void {
  w.messages.push({ id: randomUUID(), role: 'event', text, createdAt: Date.now(), versionId })
}
export async function createPage(imageName: string | null, params: NaiGenParams, model: NaiVersion, fallback: InpaintDraft): Promise<PageWorkspace> {
  if (!['v4.5', 'v5'].includes(model)) throw new Error('不支持的生图模型')
  let image = imageName ? imageInfo(imageName) : null
  const src = imageName ? imagePath(imageName) : null
  if (imageName && (!image || !src)) throw new Error('请选择仍在图库中的图片')
  let draft = fallback
  let imported = false
  if (src) try { draft = await readPngPrompt(new Blob([Uint8Array.from(readFileSync(src))], { type: 'image/png' })); imported = true } catch { /* Explicit fallback from current prompt. */ }
  const recorded = imageName ? readImageRecipe(imageName) : null
  if (recorded) {
    const r = recorded.request
    draft = { base: r.base, negative: r.negative, characters: r.characters }
    params = r.params; model = r.version; imported = true
  }
  checkDraft(draft, model)
  checkPageParams(params)
  const now = Date.now(), versionId = randomUUID(), id = randomUUID()
  if (imageName) image = ownWorkspaceImage(imageName, id)
  const w: PageWorkspace = { schema: 2, id, title: '新项目', goal: '', preserve: '', model, createdAt: now, updatedAt: now, revision: 0,
    currentVersionId: versionId, composer: '', execution: { kind: 'generate', regionId: null }, versions: [{ id: versionId, parentId: null, label: image ? '原稿' : '起点', image, createdAt: now,
      editor: { draft: clone(draft), regions: [], params: { ...params, width: image?.width ?? params.width, height: image?.height ?? params.height, count: 1, qualityTags: false, ucPreset: 'none' }, strength: 1 } }], messages: [] }
  w.versions[0].editor.model = model
  w.versions[0].initial = { model, draft: clone(draft), params: clone(w.versions[0].editor.params) }
  pageEvent(w, imported ? '会话已建立，已读取原图提示词。' : image ? '会话已建立。图片没有可读取的提示词，初始草稿请核对。' : '会话已建立。')
  return savePage(w)
}
/** Keep an owned copy so moving the user's original cannot break page history. */
export async function importPage(path: string, params: NaiGenParams, model: NaiVersion, fallback: InpaintDraft): Promise<PageWorkspace> {
  if (statSync(path).size > 40 * 1024 * 1024) throw new Error('导入图片不能超过 40 MB')
  const bytes = readFileSync(path), size = pngSize(bytes)
  if (!size || !size.width || !size.height || size.width * size.height > 4 * 1024 * 1024) throw new Error('请选择有效 PNG，最多 4096×1024 总像素')
  PNG.sync.read(bytes)
  const name = `page-import-${randomUUID()}.png`
  writeFileSync(join(imageDir(), name), bytes)
  let w: PageWorkspace
  try { w = await createPage(name, params, model, fallback) } finally { unlinkSync(join(imageDir(), name)) }
  w.title = basename(path).replace(/\.png$/i, '').slice(0, 100) || '未命名项目'
  return savePage(w)
}
export function editPage(id: string, revision: number, action: PageAction): PageWorkspace {
  if (pageLocks.has(id)) throw new Error('请等待当前分析或生成完成')
  const w = readPage(id)
  if (w.revision !== revision) throw new Error('工作区已在别处更新，请重新打开后继续')
  const v = pageCurrent(w)
  if (action.type === 'recipe') {
    const r = clone(action.request)
    if (!['v4.5', 'v5'].includes(r.version)) throw new Error('不支持的模型')
    checkDraft(r, r.version); checkPageParams(r.params)
    w.model = r.version
    v.editor.model = r.version
    v.editor.draft = { base: r.base, negative: r.negative, characters: r.characters }
    v.editor.params = { ...r.params, count: 1 }; v.editor.regions = []
    w.execution = { kind: 'generate', regionId: null }
    pageEvent(w, '已加载收藏配方，替换提示词、模型和生成设置，清除旧选区；尚未生成图片。')
  } else if (action.type === 'notes') {
    for (const t of [action.title, action.goal, action.preserve, action.composer]) if (typeof t !== 'string' || t.length > 6000) throw new Error('文本过长')
    w.title = action.title.trim().slice(0, 100) || '未命名项目'; w.goal = action.goal; w.preserve = action.preserve; w.composer = action.composer
  } else if (action.type === 'editor') {
    if (action.versionId !== v.id) throw new Error('编辑器对应的版本已切换')
    const updated = clone(action.editor)
    if (updated.draft.characters.length !== v.editor.draft.characters.length) updated.regions.forEach(r => { r.target = null })
    const unchangedMasks = updated.params.width === v.editor.params.width && updated.params.height === v.editor.params.height &&
      updated.regions.every(r => v.editor.regions.some(old => old.id === r.id && old.mask === r.mask))
    checkEditor(updated, v.image?.name, !!v.image?.missing && unchangedMasks)
    checkDraft(action.editor.draft, w.model)
    if (JSON.stringify(v.editor.draft) !== JSON.stringify(action.editor.draft)) {
      const m = pageMessage('event', '手动修改了当前提示词。', v.id)
      m.draftBefore = clone(v.editor.draft); m.draftAfter = clone(action.editor.draft); w.messages.push(m)
    }
    updated.model = w.model; v.editor = updated; v.editor.regions.forEach(r => { r.accepted = null })
    if (w.execution.regionId && !v.editor.regions.some(r => r.id === w.execution.regionId)) w.execution = { kind: 'generate', regionId: null }
  } else if (action.type === 'execution') {
    w.execution = validateExecution(w, action.execution)
  } else if (action.type === 'switch') {
    const next = w.versions.find(v => v.id === action.versionId)
    if (!next || (next.image && !imagePath(next.image.name))) throw new Error('该版本图片已不存在')
    if (next.id !== v.id) { w.currentVersionId = next.id; w.model = next.editor.model ?? next.generated?.model ?? next.initial?.model ?? w.model; w.execution = { kind: 'generate', regionId: null }; pageEvent(w, `创作蓝本切换为「${next.label}」。之后从此版本继续，其他结果保留为历史。`) }
  } else if (action.type === 'proposal') {
    const m = w.messages.find(m => m.id === action.messageId), p = m?.proposal
    if (!m || !p) throw new Error('建议不存在')
    if (action.decision === 'reject') {
      if (p.status !== 'pending') throw new Error('该建议已经处理')
      p.status = 'rejected'; pageEvent(w, `未采纳建议「${p.title}」，提示词和图片未改变。`)
    } else {
      if (m.versionId !== v.id) throw new Error('建议属于其他版本，请切回对应版本或重新讨论')
      const r = v.editor.regions.find(r => r.id === p.regionId)
      if (p.regionId && !r) throw new Error('建议对应选区已不存在')
      if (action.decision === 'accept') {
        if (p.superseded || p.status !== 'pending' || p.contextKey !== pageContextKey(v, p.regionId, w)) throw new Error('目标、提示词、选区或执行方式已变化，或建议已有更新，请重新提出修改')
        const next = p.after ? clone(p.after) : applyInpaintChanges(pageDraft(v, p.regionId), p.changes)
        checkDraft(next, w.model)
        p.previousExecution = clone(w.execution)
        p.previousTargets = v.editor.regions.map(r => ({ id: r.id, target: r.target }))
        if (p.execution) w.execution = validateExecution(w, p.execution)
        if (!r) p.previousRegions = v.editor.regions.map(r => ({ id: r.id, accepted: clone(r.accepted) }))
        if (v.editor.draft.characters.length !== next.characters.length) v.editor.regions.forEach(r => { r.target = null })
        v.editor.draft = next; v.editor.regions.forEach(r => { r.accepted = null })
        p.appliedContextKey = pageContextKey(v, p.regionId, w)
        p.status = 'accepted'; pageEvent(w, `已采纳「${p.title}」，已更新当前提示词草稿，尚未生成图片。`)
      } else {
        if (p.status !== 'accepted') throw new Error('只能撤销已采纳建议')
        const expected = p.after ?? applyInpaintChanges(p.before, p.changes)
        if (p.appliedContextKey !== pageContextKey(v, p.regionId, w) || JSON.stringify(pageDraft(v, p.regionId)) !== JSON.stringify(expected)) throw new Error('采纳后页面又有修改，不能覆盖这些新改动')
        v.editor.draft = clone(p.before)
        for (const previous of p.previousTargets ?? []) { const r = v.editor.regions.find(r => r.id === previous.id); if (r) r.target = previous.target }
        if (p.previousExecution) w.execution = clone(p.previousExecution)
        p.status = 'withdrawn'; pageEvent(w, `撤销了建议「${p.title}」，恢复采纳前的提示词。`)
      }
    }
  } else throw new Error('不支持的工作区操作')
  return savePage(w)
}
export function pageMessage(role: PageMessage['role'], text: string, versionId: string): PageMessage {
  return { id: randomUUID(), role, text, versionId, createdAt: Date.now() }
}

/** External agents submit the same reviewable proposals as the built-in collaborator. */
export function proposePage(id: string, revision: number, draft: InpaintDraft, title: string, text: string): PageWorkspace {
  if (pageLocks.has(id)) throw new Error('会话仍在运行')
  const w = readPage(id), v = pageCurrent(w)
  if (w.agentMode === 'external') throw new Error('外部接管会话请使用 reply_workspace_request 或 ui_reply_workspace_request 回复待处理需求')
  if (w.revision !== revision) throw new Error('会话已变化，请重新读取后提交建议')
  checkDraft(draft, w.model)
  if (!title.trim() || title.length > 200 || text.length > 6000) throw new Error('建议标题或说明无效')
  const message = pageMessage('assistant', text || title, v.id)
  message.author = { kind: 'external', name: '外部 Agent' }
  message.proposal = { regionId: null, title, warning: '', changes: pageChanges(v.editor.draft, draft), status: 'pending',
    contextKey: pageContextKey(v, null, w), before: clone(v.editor.draft), after: clone(draft), previousAccepted: null }
  w.messages.push(message)
  return savePage(w)
}

export function pendingExternalRequest(w: PageWorkspace) {
  return w.messages.find(m => m.externalRequest?.status === 'pending')
}
export function discussionSnapshot(w: PageWorkspace, versionId = w.currentVersionId): PageDiscussion {
  const v = w.versions.find(v => v.id === versionId)
  if (!v) throw new Error('讨论版本已不存在，请重新选择')
  const recipe = v.generated ?? v.initial
  return clone({ versionId: v.id, label: v.label, image: v.image,
    recipe: recipe ? { source: v.generated ? 'generated' : 'initial', draft: recipe.draft, params: recipe.params } : null })
}
export function discussionIsStale(w: PageWorkspace, discussion?: PageDiscussion): boolean {
  if (!discussion) return false // Requests saved before discussion snapshots used the adopted version.
  if (!w.versions.some(v => v.id === discussion.versionId)) return true
  const key = (d: PageDiscussion) => JSON.stringify([d.versionId, d.image?.name, d.image?.contentHash, !!d.image?.missing, d.recipe])
  return key(discussion) !== key(discussionSnapshot(w, discussion.versionId))
}
function writablePage(id: string, revision: number) {
  if (pageLocks.has(id)) throw new Error('会话仍在运行')
  const w = readPage(id)
  if (w.revision !== revision) throw new Error('会话已变化，请重新读取后继续')
  return w
}
export function setPageAgent(id: string, revision: number, mode: 'internal' | 'external', agent?: PageAgentIdentity): PageWorkspace {
  const w = writablePage(id, revision)
  if (!['internal', 'external'].includes(mode)) throw new Error('未知的会话处理方式')
  if (agent && w.externalAgent && w.externalAgent.sessionId !== agent.sessionId && agentIsConnected(w.externalAgent.sessionId))
    throw new Error('此会话已由另一个在线 Agent 接管，请先在界面解除接管')
  if (mode === 'internal') for (const m of w.messages) if (m.externalRequest?.status === 'pending') m.externalRequest.status = 'cancelled'
  w.agentMode = mode; w.externalAgent = mode === 'external' ? agent ?? null : null
  pageEvent(w, mode === 'external' ? (agent ? `已交给外部 Agent「${agent.name}」处理；不会调用内置 AI。` : '已切换外部 Agent，等待连接；需求会保存在本会话。') : '已切换为内置 AI；待处理的外部需求已取消。')
  return savePage(w)
}
export function queueExternalRequest(id: string, revision: number, text: string, regionId: string | null, referenceIds: string[], discussionVersionId?: string, agent?: PageAgentIdentity) {
  const w = writablePage(id, revision), v = pageCurrent(w)
  if (agent && (!agentIsConnected(agent.sessionId) || w.externalAgent?.sessionId !== agent.sessionId)) throw new Error('当前 Agent 未接管此会话')
  if (w.agentMode !== 'external') throw new Error('会话未开启外部 Agent 接管')
  if (pendingExternalRequest(w)) throw new Error('已有待处理需求，请等待回复或取消后再发送')
  if (typeof text !== 'string' || !text.trim() || text.length > 6000 || !Array.isArray(referenceIds) || referenceIds.length > 2 || referenceIds.some(id => !w.versions.some(v => v.id === id))) throw new Error('需求或引用版本无效')
  if (regionId && !v.editor.regions.some(r => r.id === regionId)) throw new Error('区域已不存在')
  const discussion = discussionSnapshot(w, discussionVersionId)
  const m = pageMessage('user', text.trim(), v.id), skills = composeSkills('workspace', w.model)
  m.discussion = discussion
  m.regionId = regionId; m.referenceIds = [...referenceIds]
  m.externalRequest = { status: 'pending', contextKey: pageContextKey(v, regionId, w) }
  m.skills = skills.skills.map(s => s.name)
  m.skillSnapshot = skills.snapshot
  w.messages.push(m); w.composer = ''
  return savePage(w)
}
export function cancelExternalRequest(id: string, revision: number, agent?: PageAgentIdentity) {
  const w = writablePage(id, revision), pending = pendingExternalRequest(w)
  if (agent && w.externalAgent?.sessionId !== agent.sessionId) throw new Error('当前 Agent 未接管此会话')
  if (!pending) throw new Error('没有待处理的外部需求')
  pending.externalRequest!.status = 'cancelled'
  pageEvent(w, '已取消外部需求，原消息保留；后续回复不会覆盖当前内容。')
  return savePage(w)
}
export function replyExternalRequest(id: string, revision: number, response: PageExternalReply, agent?: PageAgentIdentity) {
  const w = writablePage(id, revision), v = pageCurrent(w)
  if (w.agentMode !== 'external' || !agent || !agentIsConnected(agent.sessionId) || w.externalAgent?.sessionId !== agent.sessionId)
    throw new Error('当前 Agent 未接管此会话，请先连接；不会切换为内置 AI')
  const request = w.messages.find(m => m.id === response?.requestId && m.externalRequest?.status === 'pending')
  if (!request) throw new Error('需求已完成、已取消或不存在，请读取会话确认，勿重复提交')
  if (request.versionId !== v.id || request.externalRequest!.contextKey !== pageContextKey(v, request.regionId ?? null, w) || discussionIsStale(w, request.discussion))
    throw new Error('需求发出后讨论图片、目标、版本、提示词或选区已改变，请取消旧需求后重新发送')
  if (typeof response.reply !== 'string' || !response.reply.trim() || response.reply.length > 16000) throw new Error('回复须为 1～16000 字符')
  if (response.understanding && [response.understanding.goal, response.understanding.preserve].some(t => typeof t !== 'string' || t.length > 6000)) throw new Error('目标记录格式无效')
  const p = response.proposal
  if (p) {
    checkDraft(p.draft, w.model)
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200 || typeof p.warning !== 'string' || p.warning.length > 4000) throw new Error('建议标题或风险说明无效')
    validateExecution(w, p.execution)
  }
  if (response.understanding) {
    w.goal = response.understanding.goal; w.preserve = response.understanding.preserve
    pageEvent(w, `目标：${w.goal || '未指定'}${w.preserve ? '\n保留：' + w.preserve : ''}`)
  }
  const message = pageMessage('assistant', response.reply, v.id)
  message.author = { kind: 'external', name: agent.name }; message.requestId = request.id
  message.regionId = request.regionId; message.referenceIds = request.referenceIds
  message.discussion = request.discussion ? clone(request.discussion) : undefined
  message.skills = request.skills
  if (p) {
    const before = pageDraft(v, request.regionId ?? null)
    message.proposal = { regionId: request.regionId ?? null, title: p.title, warning: p.warning, changes: pageChanges(before, p.draft),
      status: 'pending', contextKey: pageContextKey(v, request.regionId ?? null, w), before: clone(before), after: clone(p.draft),
      execution: validateExecution(w, p.execution), previousAccepted: null }
  }
  request.externalRequest!.status = 'completed'; w.messages.push(message)
  return savePage(w)
}

export function validateExecution(w: PageWorkspace, e: import('../shared/page-workspace').PageExecution) {
  if (!e || !['generate', 'inpaint'].includes(e.kind)) throw new Error('请选择执行方式')
  if (e.kind === 'generate') return { kind: 'generate' as const, regionId: null }
  const v = pageCurrent(w)
  if (!v.image || !imagePath(v.image.name) || !v.editor.regions.some(r => r.id === e.regionId)) throw new Error('局部重绘需要可读取的底图和明确的遮罩')
  return { kind: 'inpaint' as const, regionId: e.regionId }
}
export function deletePage(id: string, revision: number): void {
  if (pageLocks.has(id)) throw new Error('请等待当前操作完成后删除')
  const w = readPage(id)
  if (w.revision !== revision) throw new Error('会话已更新，请刷新后删除')
  const removed = join(directory(), 'removed'); mkdirSync(removed, { recursive: true })
  renameSync(file(id), join(removed, id + '-' + Date.now() + '.json'))
  pageIndex.delete(file(id))
}

export function listRemovedPages(): { token: string; title: string; removedAt: number }[] {
  const dir = join(directory(), 'removed')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(n => /^[a-f0-9-]{36}-\d+\.json$/.test(n)).flatMap(token => {
    try { const w = JSON.parse(readFileSync(join(dir, token), 'utf8')); return [{ token, title: String(w.title), removedAt: Number(token.slice(37, -5)) }] } catch { return [] }
  }).sort((a, b) => b.removedAt - a.removedAt)
}
export function restorePage(token: string): PageWorkspace {
  if (!listRemovedPages().some(p => p.token === token)) throw new Error('回收站中的会话不存在')
  const id = token.slice(0, 36)
  if (pageLocks.has(id)) throw new Error('项目图片正在清理，请稍后再恢复记录')
  if (existsSync(file(id))) throw new Error('同名会话已经存在，不能覆盖')
  renameSync(join(directory(), 'removed', token), file(id))
  return readPage(id)
}
export function recoverPageImage(id: string, revision: number, versionId: string, path: string): PageWorkspace {
  const w = writablePage(id, revision), v = w.versions.find(v => v.id === versionId)
  if (!v?.image || imagePath(v.image.name)) throw new Error('仅可恢复缺失的历史图片')
  if (!v.image.contentHash) throw new Error('旧记录没有原图校验信息，请将图片导入新会话，避免误替换历史结果')
  if (statSync(path).size > 40 * 1024 * 1024) throw new Error('图片不能超过 40 MB')
  const bytes = readFileSync(path)
  if (createHash('sha256').update(bytes).digest('hex') !== v.image.contentHash) throw new Error('所选文件与原图不同，请选择当时导出的原始 PNG')
  restoreImageFile(v.image.name, bytes); v.image.missing = false
  pageEvent(w, `已恢复「${v.label}」的原始图片。`)
  return savePage(w)
}
