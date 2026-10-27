import { regionIds, selectRegions } from '../../../shared/workspace/regions'
import { applyInpaintChanges } from '../../../shared/prompts/inpaint-plan'
import {
  pageContextKey,
  pageCurrent,
  pageDraft,
  type PageAction,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { clone, pageEvent } from './snapshot'
import { checkDraft, validateExecution } from './validation'

export function applyProposalDecision(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'proposal' }>,
): void {
  const version = pageCurrent(workspace)

  const message = workspace.messages.find((message2) => message2.id === action.messageId)
  const proposal = message?.proposal
  if (!message || !proposal) {
    throw new Error('建议不存在')
  }
  if (action.decision === 'reject') {
    if (proposal.status !== 'pending') {
      throw new Error('该建议已经处理')
    }
    proposal.status = 'rejected'
    pageEvent(workspace, `未采纳建议「${proposal.title}」，提示词和图片未改变。`)
  } else {
    if (message.versionId !== version.id) {
      throw new Error('建议属于其他版本，请切回对应版本或重新讨论')
    }
    const regions = selectRegions(version, regionIds(proposal))
    if (action.decision === 'accept') {
      if (
        proposal.superseded ||
        proposal.status !== 'pending' ||
        proposal.contextKey !== pageContextKey(version, regionIds(proposal), workspace)
      ) {
        throw new Error('目标、提示词、选区或执行方式已变化，或建议已有更新，请重新提出修改')
      }
      const next = proposal.after
        ? clone(proposal.after)
        : applyInpaintChanges(pageDraft(version, proposal.regionId), proposal.changes)
      checkDraft(next, workspace.model)
      proposal.previousExecution = clone(workspace.execution)
      proposal.previousTargets = version.editor.regions.map((region2) => ({
        id: region2.id,
        target: region2.target,
      }))
      if (proposal.execution) {
        workspace.execution = validateExecution(workspace, proposal.execution)
      }
      if (!regions.length) {
        proposal.previousRegions = version.editor.regions.map((region2) => ({
          id: region2.id,
          accepted: clone(region2.accepted),
        }))
      }
      if (version.editor.draft.characters.length !== next.characters.length) {
        version.editor.regions.forEach((region2) => {
          region2.target = null
        })
      }
      version.editor.draft = next
      version.editor.regions.forEach((region2) => {
        region2.accepted = null
      })
      proposal.appliedContextKey = pageContextKey(version, regionIds(proposal), workspace)
      proposal.status = 'accepted'
      pageEvent(workspace, `已采纳「${proposal.title}」，已更新当前提示词草稿，尚未生成图片。`)
    } else {
      if (proposal.status !== 'accepted') {
        throw new Error('只能撤销已采纳建议')
      }
      const expected = proposal.after ?? applyInpaintChanges(proposal.before, proposal.changes)
      if (
        proposal.appliedContextKey !== pageContextKey(version, regionIds(proposal), workspace) ||
        JSON.stringify(pageDraft(version, proposal.regionId)) !== JSON.stringify(expected)
      ) {
        throw new Error('采纳后页面又有修改，不能覆盖这些新改动')
      }
      version.editor.draft = clone(proposal.before)
      for (const previous of proposal.previousTargets ?? []) {
        const region2 = version.editor.regions.find((region3) => region3.id === previous.id)
        if (region2) {
          region2.target = previous.target
        }
      }
      if (proposal.previousExecution) {
        workspace.execution = clone(proposal.previousExecution)
      }
      proposal.status = 'withdrawn'
      pageEvent(workspace, `撤销了建议「${proposal.title}」，恢复采纳前的提示词。`)
    }
  }
}
