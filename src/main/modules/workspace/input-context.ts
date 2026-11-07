import type { PageInputContext, PageInputImage } from '../../../shared/workspace/context'
import {
  isRoutinePageEvent,
  latestPageExecution,
  pageEventMetadata,
} from '../../../shared/workspace/events'
import {
  pageCurrent,
  type PageMessage,
  type PageSkillSnapshot,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { regionIds, regionNotes, selectRegions } from '../../../shared/workspace/regions'
import { discussionSnapshot } from './snapshot'

/** Filter only redundant receipts; all original records remain available for full-text lookup. */
export function inputHistory(workspace: PageWorkspace, request: PageMessage) {
  const messages = [...workspace.messages.filter((message) => message.id !== request.id), request]
  const decisions = inputDecisions(workspace)
  const relevant = messages.filter((message) => !routineInputReceipt(message, decisions))
  const recent = relevant.slice(-24)
  const earlier = relevant
    .slice(0, -24)
    .filter(
      (message) =>
        message.role === 'user' ||
        message.role === 'event' ||
        message.proposal ||
        message.proposalSummary,
    )
    .slice(-50)
  return {
    recent,
    earlier,
    decisions,
    filteredRoutineCount: messages.length - relevant.length,
    omittedCount: relevant.length - recent.length - earlier.length,
  }
}

function inputDecisions(workspace: PageWorkspace): PageInputContext['history']['decisions'] {
  return workspace.messages
    .flatMap((message) => {
      const proposal = message.proposal ?? message.proposalSummary
      if (!proposal || proposal.status === 'pending') {
        return []
      }
      return [
        {
          messageId: message.id,
          versionId: message.versionId,
          title: proposal.title,
          status: proposal.status,
          createdAt: message.createdAt,
        },
      ]
    })
    .slice(-24)
}

function routineInputReceipt(
  message: PageMessage,
  decisions: PageInputContext['history']['decisions'],
): boolean {
  if (!isRoutinePageEvent(message)) {
    return false
  }
  const event = pageEventMetadata(message)
  if (!event || event.type === 'request-cancelled') {
    return false
  }
  if (event.type === 'proposal') {
    return (
      event.decision === 'accepted' &&
      decisions.some(
        (decision) =>
          decision.messageId === event.messageId &&
          decision.status === 'accepted' &&
          decision.versionId === message.versionId,
      )
    )
  }
  if (event.type === 'legacy' && event.category === 'proposal') {
    // No stable proposal ID in old receipts: only remove an unambiguous duplicate acceptance.
    const matches = decisions.filter(
      (decision) =>
        decision.versionId === message.versionId &&
        decision.createdAt <= message.createdAt &&
        message.text === `已采纳「${decision.title}」，已更新当前提示词草稿，尚未生成图片。`,
    )
    return matches.length === 1 && matches[0].status === 'accepted'
  }
  if (
    message.text === '已切换为内置 AI；待处理的外部需求已取消。' ||
    message.text === '已加载收藏配方，替换提示词、模型和生成设置，清除旧选区；尚未生成图片。'
  ) {
    return false
  }
  return true
}

function executionObservations(workspace: PageWorkspace) {
  const latestExecution = latestPageExecution(workspace.messages)
  let latestBillingObservation: PageInputContext['latestBillingObservation'] = null
  for (let index = workspace.messages.length - 1; index >= 0; index--) {
    const message = workspace.messages[index]
    const event = pageEventMetadata(message)
    const billing =
      event?.type === 'execution' || (event?.type === 'legacy' && event.category === 'billing')
        ? event.billing
        : undefined
    if (billing && billing.status !== 'not-run' && !latestBillingObservation) {
      latestBillingObservation = { messageId: message.id, observedAt: message.createdAt, billing }
      break
    }
  }
  return { latestExecution, latestBillingObservation }
}

/** Metadata only: never reads images, re-composes rules, or summarizes stored message bodies. */
export function buildPageInputContext(
  workspace: PageWorkspace,
  request: PageMessage,
  skills: PageSkillSnapshot,
): PageInputContext {
  const version = pageCurrent(workspace)
  const discussion = request.discussion ?? discussionSnapshot(workspace)
  const references = (request.referenceIds ?? []).map((id) => discussionSnapshot(workspace, id))
  const regions = selectRegions(version, regionIds(request))
  const history = inputHistory(workspace, request)
  const images: PageInputImage[] = [
    {
      id: 'edit-target',
      role: 'edit-target',
      versionId: version.id,
      label: version.label,
      imageName: version.image?.name ?? null,
      status: imageStatus(version.image),
    },
    {
      id: 'discussion',
      role: 'discussion',
      versionId: discussion.versionId,
      label: discussion.label,
      imageName: discussion.image?.name ?? null,
      status: imageStatus(discussion.image),
    },
    ...references.map((reference, index): PageInputImage => ({
      id: `reference:${index}`,
      role: 'reference',
      versionId: reference.versionId,
      label: reference.label,
      imageName: reference.image?.name ?? null,
      status: imageStatus(reference.image),
    })),
    ...regions.map((region): PageInputImage => ({
      id: `region:${region.id}`,
      role: 'region',
      versionId: version.id,
      label: region.label,
      imageName: version.image?.name ?? null,
      regionId: region.id,
      status: imageStatus(version.image),
    })),
  ]
  return structuredClone({
    schema: 1,
    requestId: request.id,
    workspaceId: workspace.id,
    revision: workspace.revision,
    capturedAt: request.createdAt,
    goal: workspace.goal,
    preserve: workspace.preserve,
    model: workspace.model,
    discussion,
    editTarget: {
      versionId: version.id,
      label: version.label,
      parentId: version.parentId,
      image: version.image,
      model: version.editor.model ?? workspace.model,
      draft: version.editor.draft,
      params: version.editor.params,
      strength: version.editor.strength,
    },
    execution: workspace.execution,
    ...executionObservations(workspace),
    selectedRegions: regionNotes(regions).map((region) => ({ ...region, bounds: null })),
    references,
    rules: {
      digest: skills.digest,
      characters: skills.text.length,
      entries: (skills.sections ?? []).map((section) => ({
        id: section.id,
        name: section.name,
        description: section.description,
        scope: section.scope,
        model: section.model,
        priority: section.priority,
        digest: section.digest,
        characters: section.end - section.start,
        delivery: section.resourcePath ? ('on-demand' as const) : ('initial' as const),
        reason: ruleReason(section),
      })),
    },
    history: {
      recentIds: history.recent.map((message) => message.id),
      earlierIds: history.earlier.map((message) => message.id),
      filteredRoutineCount: history.filteredRoutineCount,
      omittedCount: history.omittedCount,
      decisions: history.decisions,
    },
    images: {
      mode: workspace.agentMode === 'external' ? 'external-reference' : 'unassembled',
      entries: images,
    },
  })
}

function imageStatus(image: PageInputContext['editTarget']['image']): PageInputImage['status'] {
  if (!image) {
    return 'none'
  }
  return image.missing ? 'missing' : 'available'
}

function ruleReason(section: NonNullable<PageSkillSnapshot['sections']>[number]): string {
  if (section.scope === 'core') {
    return '本轮必读的规则选择与优先级总则'
  }
  if (section.resourcePath) {
    return '已启用规则的冻结参考资料；按入口条件读取，未自动发送正文'
  }
  return `用户启用且适用当前模型；按 ${section.scope} 范围和本轮任务选择条款`
}
