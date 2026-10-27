import { createHash } from 'node:crypto'
import { currentAgent } from '../agent-sessions'
import type { PageWorkspace } from '../../shared/page-workspace'
import { workspaceResult } from './workspace-result'
import { candidatePage } from './candidate-page'
import { readPage, pageReadStamp } from '../page-workspaces'

type Snapshot = { metadata: string; versions: Map<string, string>; messages: Map<string, string>; readStamp?: string }
// Fingerprints only, scoped to the connection. No second copy of prompts/history.
const snapshots = new WeakMap<object, Map<string, Snapshot>>()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Writes acknowledge current state without echoing every historical prompt. */
export function workspaceReceipt(w: PageWorkspace) { return readWorkspaceResult(w, {}) }
/** Called inside the desktop workspace lock, so unsaved edits are still rejected. */
export function readStoredWorkspaceResult(id: string, args: Record<string, unknown>) {
  const detail = args.detail === 'full' ? 'full' : 'summary', agent = currentAgent()
  const key = (revision: unknown) => `${id}:${revision}:${detail}`
  const baseline = agent && args.since_revision !== undefined ? snapshots.get(agent)?.get(key(args.since_revision)) : undefined
  if (baseline?.readStamp && args.message_ids === undefined && args.version_ids === undefined
    && args.before_message_id === undefined && args.before_version_id === undefined
    && (args.history_revision === undefined || args.history_revision === args.since_revision)
    && pageReadStamp(id) === baseline.readStamp) return { id, revision: args.since_revision, detail, notModified: true }
  const w = readPage(id), result = readWorkspaceResult(w, args)
  const saved = agent ? snapshots.get(agent)?.get(key(w.revision)) : undefined
  if (saved && args.message_ids === undefined && args.version_ids === undefined) saved.readStamp = pageReadStamp(id)
  return result
}
export function readWorkspaceResult(w: PageWorkspace, args: Record<string, unknown>) {
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const limit = Number(args.message_limit ?? 5)
  if (args.before_message_id !== undefined && args.history_revision === undefined) throw Error('翻页须携带上一页的 history.revision 作为 history_revision')
  if (args.history_revision !== undefined && args.history_revision !== w.revision) throw Error('历史已更新，请从第一页重新读取，勿合并不同版本的分页')
  if ((args.message_ids !== undefined || args.version_ids !== undefined) && (args.since_revision !== undefined || args.before_message_id !== undefined || args.before_version_id !== undefined)) throw Error('指定 id 读取不能与增量或分页游标同时使用')
  const { versions, messages, ...metadata } = workspaceResult(w)
  // Hash original candidates so a changed mask is observable even though its
  // pixels are deliberately omitted from the returned record.
  const snapshot: Snapshot = { metadata: digest(metadata), versions: new Map(w.versions.map(v => [v.id, digest(v)])), messages: new Map(messages.map(m => [m.id, digest(m)])) }
  const agent = currentAgent()
  let cache = agent ? snapshots.get(agent) : undefined
  if (agent && !cache) { cache = new Map(); snapshots.set(agent, cache) }
  const key = (revision: unknown) => `${w.id}:${revision}:${detail}`
  const baseline = args.since_revision === undefined ? undefined : cache?.get(key(args.since_revision))
  const wantsDelta = args.since_revision !== undefined
  if (wantsDelta && !baseline && (args.before_message_id !== undefined || args.before_version_id !== undefined)) throw Error('增量基线已过期，请从第一页重新读取')
  if (wantsDelta && baseline && baseline.metadata === snapshot.metadata
    && digest([...baseline.versions]) === digest([...snapshot.versions]) && digest([...baseline.messages]) === digest([...snapshot.messages])
    && args.before_message_id === undefined && args.before_version_id === undefined) return { id: w.id, revision: w.revision, detail, notModified: true }
  const delta = wantsDelta && !!baseline
  const requestedMessages = args.message_ids as string[] | undefined
  const requestedVersions = args.version_ids as string[] | undefined
  if (requestedMessages?.some(id => !snapshot.messages.has(id))) throw Error('目标消息不存在，请重新读取历史')
  if (requestedVersions?.some(id => !snapshot.versions.has(id))) throw Error('目标候选不存在，请重新读取会话')
  const selectedMessages = messages.filter(m => requestedMessages ? requestedMessages.includes(m.id) : requestedVersions ? false : !delta || baseline!.messages.get(m.id) !== snapshot.messages.get(m.id))
  const end = args.before_message_id === undefined ? selectedMessages.length : selectedMessages.findIndex(m => m.id === args.before_message_id)
  if (end < 0) throw Error('历史游标不存在，请重新读取会话')
  const start = requestedMessages ? 0 : Math.max(0, end - limit)
  const selectedVersions = versions.filter(v => requestedVersions ? requestedVersions.includes(v.id) : requestedMessages ? false : !delta || baseline!.versions.get(v.id) !== snapshot.versions.get(v.id))
  const includeVersions = !requestedMessages || !!requestedVersions
  const versionPage = candidatePage(selectedVersions, args, w.revision, versions.length,
    includeVersions && (args.before_message_id === undefined || args.before_version_id !== undefined), !!requestedVersions)
  const includeMessages = (!requestedVersions || !!requestedMessages) && (args.before_version_id === undefined || args.before_message_id !== undefined)
  // Cache successful revision reads, even when paged. Deltas include changed
  // older messages; they are upserts, not merely newly appended chat messages.
  if (!requestedMessages && !requestedVersions) {
    cache?.set(key(w.revision), snapshot)
    while (cache && cache.size > 32) cache.delete(cache.keys().next().value!)
  }
  return {
    ...(!requestedMessages && !requestedVersions && (!delta || baseline!.metadata !== snapshot.metadata) ? metadata : { id: w.id, revision: w.revision }),
    detail, delta,
    ...(wantsDelta && !baseline ? { resetRequired: true, resetReason: '增量基线未缓存或已过期；此响应为当前快照，请重建缓存并按需补齐历史。' } : {}),
    ...(delta ? { sinceRevision: args.since_revision,
      removedVersionIds: [...baseline!.versions.keys()].filter(id => !snapshot.versions.has(id)),
      removedMessageIds: [...baseline!.messages.keys()].filter(id => !snapshot.messages.has(id)) } : {}),
    versions: versionPage.items.map(v => detail === 'full' ? v : { id: v.id, parentId: v.parentId, label: v.label, image: v.image,
      imageCleared: v.imageCleared, createdAt: v.createdAt, groupId: v.groupId, groupNumber: v.groupNumber, candidateNumber: v.candidateNumber,
      regionCount: v.editor.regions.length, detailDigest: snapshot.versions.get(v.id) }),
    versionsPage: versionPage.page,
    messages: (includeMessages ? selectedMessages.slice(start, end) : []).map(m => detail === 'full' ? m : {
      id: m.id, role: m.role, text: m.text.slice(0, 400), textTruncated: m.text.length > 400, textLength: m.text.length,
      createdAt: m.createdAt, versionId: m.versionId, regionId: m.regionId, referenceIds: m.referenceIds, requestId: m.requestId,
      externalRequest: m.externalRequest, error: m.error, author: m.author, skillSnapshot: m.skillSnapshot,
      proposal: m.proposal ? { title: m.proposal.title, status: m.proposal.status, superseded: m.proposal.superseded, regionId: m.proposal.regionId } : m.proposalSummary,
      discussion: m.discussion ? { versionId: m.discussion.versionId, label: m.discussion.label, image: m.discussion.image } : undefined,
      detailDigest: snapshot.messages.get(m.id)
    }),
    history: { total: messages.length, matching: selectedMessages.length, limit, revision: w.revision, included: includeMessages,
      hasMore: includeMessages && start > 0, nextBeforeMessageId: includeMessages && start > 0 ? selectedMessages[start].id : null },
    ...(requestedMessages || requestedVersions ? { partial: true } : {})
  }
}
