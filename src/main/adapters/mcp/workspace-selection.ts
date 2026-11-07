import { createHash } from 'node:crypto'
import type { PageWorkspace } from '../../../shared/workspace/model'
import { candidatePage } from './candidate-page'
import {
  inputContextSummary,
  workspaceMessageResult,
  workspaceVersionResult,
} from './workspace-result'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function summarizeVersion(
  version: ReturnType<typeof workspaceVersionResult>,
  hash: string | undefined,
) {
  return {
    id: version.id,
    parentId: version.parentId,
    label: version.label,
    image: version.image,
    imageCleared: version.imageCleared,
    createdAt: version.createdAt,
    groupId: version.groupId,
    groupNumber: version.groupNumber,
    candidateNumber: version.candidateNumber,
    regionCount: version.editor.regions.length,
    detailDigest: hash,
  }
}

export function summarizeMessage(
  message: ReturnType<typeof workspaceMessageResult>,
  hash: string | undefined,
) {
  return {
    id: message.id,
    role: message.role,
    text: message.text.slice(0, 400),
    textTruncated: message.text.length > 400,
    textLength: message.text.length,
    createdAt: message.createdAt,
    versionId: message.versionId,
    regionId: message.regionId,
    regionIds: message.regionIds,
    regions: message.regions,
    referenceIds: message.referenceIds,
    requestId: message.requestId,
    externalRequest: message.externalRequest,
    error: message.error,
    event: message.event,
    author: message.author,
    skillSnapshot: message.skillSnapshot,
    inputContext: inputContextSummary(message.inputContext),
    proposal: message.proposal
      ? {
          title: message.proposal.title,
          status: message.proposal.status,
          superseded: message.proposal.superseded,
          regionId: message.proposal.regionId,
          regionIds: message.proposal.regionIds,
        }
      : message.proposalSummary,
    discussion: message.discussion
      ? {
          versionId: message.discussion.versionId,
          label: message.discussion.label,
          image: message.discussion.image,
        }
      : undefined,
    detailDigest: hash,
  }
}

/** Exact-ID reads do not establish a delta baseline or inspect unrelated history/masks. */
export function selectWorkspaceResult(workspace: PageWorkspace, args: Record<string, unknown>) {
  const messageIds = args.message_ids as string[] | undefined
  const versionIds = args.version_ids as string[] | undefined
  const messages = workspace.messages.filter((message) => messageIds?.includes(message.id))
  const versions = workspace.versions.filter((version) => versionIds?.includes(version.id))
  if (messageIds?.some((id) => !messages.some((message) => message.id === id))) {
    throw new Error('目标消息不存在，请重新读取历史')
  }
  if (versionIds?.some((id) => !versions.some((version) => version.id === id))) {
    throw new Error('目标候选不存在，请重新读取会话')
  }
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const versionPage = candidatePage(
    versions,
    args,
    workspace.revision,
    workspace.versions.length,
    !!versionIds,
    !!versionIds,
  )
  return structuredClone({
    id: workspace.id,
    revision: workspace.revision,
    detail,
    delta: false,
    partial: true,
    versions: versionPage.items.map((version) => {
      const result = workspaceVersionResult(version)
      return detail === 'full' ? result : summarizeVersion(result, digest(version))
    }),
    versionsPage: versionPage.page,
    messages: messages.map((message) => {
      const result = workspaceMessageResult(message)
      return detail === 'full' ? result : summarizeMessage(result, digest(result))
    }),
    history: {
      total: workspace.messages.length,
      matching: messages.length,
      limit: Number(args.message_limit ?? 5),
      revision: workspace.revision,
      included: !!messageIds,
      hasMore: false,
      nextBeforeMessageId: null,
    },
  })
}
