import { createHash } from 'node:crypto'
import type { PageWorkspace } from '../../../shared/workspace/model'
import { currentAgent } from '../../modules/workspace/agent-sessions'
import { pageReadStamp } from '../../modules/workspace/index-cache'
import { readPage } from '../../modules/workspace/repository'
import { candidatePage } from './candidate-page'
import { workspaceResult } from './workspace-result'

type Snapshot = {
  metadata: string
  versions: Map<string, string>
  messages: Map<string, string>
  readStamp?: string
}
// Fingerprints only, scoped to the connection. No second copy of prompts/history.
const snapshots = new WeakMap<object, Map<string, Snapshot>>()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Writes acknowledge current state without echoing every historical prompt. */
export function workspaceReceipt(workspace: PageWorkspace) {
  return readWorkspaceResult(workspace, {})
}
/** Called inside the desktop workspace lock, so unsaved edits are still rejected. */
export function readStoredWorkspaceResult(id: string, args: Record<string, unknown>) {
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const agent = currentAgent()
  const key = (revision: unknown) => `${id}:${revision}:${detail}`
  const baseline =
    agent && args.since_revision !== undefined
      ? snapshots.get(agent)?.get(key(args.since_revision))
      : undefined
  if (
    baseline?.readStamp &&
    args.message_ids === undefined &&
    args.version_ids === undefined &&
    args.before_message_id === undefined &&
    args.before_version_id === undefined &&
    (args.history_revision === undefined || args.history_revision === args.since_revision) &&
    pageReadStamp(id) === baseline.readStamp
  ) {
    return { id, revision: args.since_revision, detail, notModified: true }
  }
  const workspace = readPage(id)
  const result = readWorkspaceResult(workspace, args)
  const saved = agent ? snapshots.get(agent)?.get(key(workspace.revision)) : undefined
  if (saved && args.message_ids === undefined && args.version_ids === undefined) {
    saved.readStamp = pageReadStamp(id)
  }
  return result
}
export function readWorkspaceResult(workspace: PageWorkspace, args: Record<string, unknown>) {
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const limit = Number(args.message_limit ?? 5)
  if (args.before_message_id !== undefined && args.history_revision === undefined) {
    throw Error('翻页须携带上一页的 history.revision 作为 history_revision')
  }
  if (args.history_revision !== undefined && args.history_revision !== workspace.revision) {
    throw Error('历史已更新，请从第一页重新读取，勿合并不同版本的分页')
  }
  if (
    (args.message_ids !== undefined || args.version_ids !== undefined) &&
    (args.since_revision !== undefined ||
      args.before_message_id !== undefined ||
      args.before_version_id !== undefined)
  ) {
    throw Error('指定 id 读取不能与增量或分页游标同时使用')
  }
  const { versions, messages, ...metadata } = workspaceResult(workspace)
  // Hash original candidates so a changed mask is observable even though its
  // pixels are deliberately omitted from the returned record.
  const snapshot: Snapshot = {
    metadata: digest(metadata),
    versions: new Map(workspace.versions.map((version) => [version.id, digest(version)])),
    messages: new Map(
      messages.map((messageSnapshot) => [messageSnapshot.id, digest(messageSnapshot)]),
    ),
  }
  const agent = currentAgent()
  let cache = agent ? snapshots.get(agent) : undefined
  if (agent && !cache) {
    cache = new Map()
    snapshots.set(agent, cache)
  }
  const key = (revision: unknown) => `${workspace.id}:${revision}:${detail}`
  const baseline =
    args.since_revision === undefined ? undefined : cache?.get(key(args.since_revision))
  const wantsDelta = args.since_revision !== undefined
  if (
    wantsDelta &&
    !baseline &&
    (args.before_message_id !== undefined || args.before_version_id !== undefined)
  ) {
    throw Error('增量基线已过期，请从第一页重新读取')
  }
  if (
    wantsDelta &&
    baseline &&
    baseline.metadata === snapshot.metadata &&
    digest([...baseline.versions]) === digest([...snapshot.versions]) &&
    digest([...baseline.messages]) === digest([...snapshot.messages]) &&
    args.before_message_id === undefined &&
    args.before_version_id === undefined
  ) {
    return { id: workspace.id, revision: workspace.revision, detail, notModified: true }
  }
  const delta = wantsDelta && !!baseline
  const requestedMessages = args.message_ids as string[] | undefined
  const requestedVersions = args.version_ids as string[] | undefined
  if (requestedMessages?.some((id) => !snapshot.messages.has(id))) {
    throw Error('目标消息不存在，请重新读取历史')
  }
  if (requestedVersions?.some((id) => !snapshot.versions.has(id))) {
    throw Error('目标候选不存在，请重新读取会话')
  }
  const selectedMessages = messages.filter((messageSnapshot) => {
    if (requestedMessages) {
      return requestedMessages.includes(messageSnapshot.id)
    }
    if (requestedVersions) {
      return false
    }
    return (
      !delta ||
      baseline!.messages.get(messageSnapshot.id) !== snapshot.messages.get(messageSnapshot.id)
    )
  })
  const end =
    args.before_message_id === undefined
      ? selectedMessages.length
      : selectedMessages.findIndex(
          (messageSnapshot) => messageSnapshot.id === args.before_message_id,
        )
  if (end < 0) {
    throw Error('历史游标不存在，请重新读取会话')
  }
  const start = requestedMessages ? 0 : Math.max(0, end - limit)
  const selectedVersions = versions.filter((versionSnapshot) => {
    if (requestedVersions) {
      return requestedVersions.includes(versionSnapshot.id)
    }
    if (requestedMessages) {
      return false
    }
    return (
      !delta ||
      baseline!.versions.get(versionSnapshot.id) !== snapshot.versions.get(versionSnapshot.id)
    )
  })
  const includeVersions = !requestedMessages || !!requestedVersions
  const versionPage = candidatePage(
    selectedVersions,
    args,
    workspace.revision,
    versions.length,
    includeVersions &&
      (args.before_message_id === undefined || args.before_version_id !== undefined),
    !!requestedVersions,
  )
  const includeMessages =
    (!requestedVersions || !!requestedMessages) &&
    (args.before_version_id === undefined || args.before_message_id !== undefined)
  // Cache successful revision reads, even when paged. Deltas include changed
  // older messages; they are upserts, not merely newly appended chat messages.
  if (!requestedMessages && !requestedVersions) {
    cache?.set(key(workspace.revision), snapshot)
    while (cache && cache.size > 32) {
      cache.delete(cache.keys().next().value!)
    }
  }
  return {
    ...(!requestedMessages &&
    !requestedVersions &&
    (!delta || baseline!.metadata !== snapshot.metadata)
      ? metadata
      : { id: workspace.id, revision: workspace.revision }),
    detail,
    delta,
    ...(wantsDelta && !baseline
      ? {
          resetRequired: true,
          resetReason: '增量基线未缓存或已过期；此响应为当前快照，请重建缓存并按需补齐历史。',
        }
      : {}),
    ...(delta
      ? {
          sinceRevision: args.since_revision,
          removedVersionIds: [...baseline!.versions.keys()].filter(
            (id) => !snapshot.versions.has(id),
          ),
          removedMessageIds: [...baseline!.messages.keys()].filter(
            (id) => !snapshot.messages.has(id),
          ),
        }
      : {}),
    versions: versionPage.items.map((versionSnapshot) =>
      detail === 'full'
        ? versionSnapshot
        : {
            id: versionSnapshot.id,
            parentId: versionSnapshot.parentId,
            label: versionSnapshot.label,
            image: versionSnapshot.image,
            imageCleared: versionSnapshot.imageCleared,
            createdAt: versionSnapshot.createdAt,
            groupId: versionSnapshot.groupId,
            groupNumber: versionSnapshot.groupNumber,
            candidateNumber: versionSnapshot.candidateNumber,
            regionCount: versionSnapshot.editor.regions.length,
            detailDigest: snapshot.versions.get(versionSnapshot.id),
          },
    ),
    versionsPage: versionPage.page,
    messages: (includeMessages ? selectedMessages.slice(start, end) : []).map((messageSnapshot) => {
      if (detail === 'full') {
        return messageSnapshot
      }
      return {
        id: messageSnapshot.id,
        role: messageSnapshot.role,
        text: messageSnapshot.text.slice(0, 400),
        textTruncated: messageSnapshot.text.length > 400,
        textLength: messageSnapshot.text.length,
        createdAt: messageSnapshot.createdAt,
        versionId: messageSnapshot.versionId,
        regionId: messageSnapshot.regionId,
        regionIds: messageSnapshot.regionIds,
        regions: messageSnapshot.regions,
        referenceIds: messageSnapshot.referenceIds,
        requestId: messageSnapshot.requestId,
        externalRequest: messageSnapshot.externalRequest,
        error: messageSnapshot.error,
        author: messageSnapshot.author,
        skillSnapshot: messageSnapshot.skillSnapshot,
        proposal: messageSnapshot.proposal
          ? {
              title: messageSnapshot.proposal.title,
              status: messageSnapshot.proposal.status,
              superseded: messageSnapshot.proposal.superseded,
              regionId: messageSnapshot.proposal.regionId,
              regionIds: messageSnapshot.proposal.regionIds,
            }
          : messageSnapshot.proposalSummary,
        discussion: messageSnapshot.discussion
          ? {
              versionId: messageSnapshot.discussion.versionId,
              label: messageSnapshot.discussion.label,
              image: messageSnapshot.discussion.image,
            }
          : undefined,
        detailDigest: snapshot.messages.get(messageSnapshot.id),
      }
    }),
    history: {
      total: messages.length,
      matching: selectedMessages.length,
      limit,
      revision: workspace.revision,
      included: includeMessages,
      hasMore: includeMessages && start > 0,
      nextBeforeMessageId: includeMessages && start > 0 ? selectedMessages[start].id : null,
    },
    ...(requestedMessages || requestedVersions ? { partial: true } : {}),
  }
}
