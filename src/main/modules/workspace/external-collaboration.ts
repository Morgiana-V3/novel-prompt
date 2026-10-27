import type { InpaintDraft } from '../../../shared/prompts/types'
import type { PageAgentIdentity, PageExternalReply } from '../../../shared/workspace/model'
import {
  pageChanges,
  pageContextKey,
  pageCurrent,
  pageDraft,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { composeSkills } from '../skills/service'
import { agentIsConnected } from './agent-sessions'
import { pageLocks } from './locks'
import { readPage, savePage } from './repository'
import {
  clone,
  discussionIsStale,
  discussionSnapshot,
  pageEvent,
  pageMessage,
  pendingExternalRequest,
} from './snapshot'
import { checkDraft, validateExecution } from './validation'
import { writablePage } from './writable'

/** External agents submit the same reviewable proposals as the built-in collaborator. */
export function proposePage(
  id: string,
  revision: number,
  draft: InpaintDraft,
  title: string,
  text: string,
): PageWorkspace {
  if (pageLocks.has(id)) {
    throw new Error('会话仍在运行')
  }
  const workspace = readPage(id)
  const version = pageCurrent(workspace)
  if (workspace.agentMode === 'external') {
    throw new Error(
      '外部接管会话请使用 reply_workspace_request 或 ui_reply_workspace_request 回复待处理需求',
    )
  }
  if (workspace.revision !== revision) {
    throw new Error('会话已变化，请重新读取后提交建议')
  }
  checkDraft(draft, workspace.model)
  if (!title.trim() || title.length > 200 || text.length > 6000) {
    throw new Error('建议标题或说明无效')
  }
  const message = pageMessage('assistant', text || title, version.id)
  message.author = { kind: 'external', name: '外部 Agent' }
  message.proposal = {
    regionId: null,
    title,
    warning: '',
    changes: pageChanges(version.editor.draft, draft),
    status: 'pending',
    contextKey: pageContextKey(version, null, workspace),
    before: clone(version.editor.draft),
    after: clone(draft),
    previousAccepted: null,
  }
  workspace.messages.push(message)
  return savePage(workspace)
}

export function setPageAgent(
  id: string,
  revision: number,
  mode: 'internal' | 'external',
  agent?: PageAgentIdentity,
): PageWorkspace {
  const workspace = writablePage(id, revision)
  if (!['internal', 'external'].includes(mode)) {
    throw new Error('未知的会话处理方式')
  }
  if (
    agent &&
    workspace.externalAgent &&
    workspace.externalAgent.sessionId !== agent.sessionId &&
    agentIsConnected(workspace.externalAgent.sessionId)
  ) {
    throw new Error('此会话已由另一个在线 Agent 接管，请先在界面解除接管')
  }
  if (mode === 'internal') {
    for (const message of workspace.messages) {
      if (message.externalRequest?.status === 'pending') {
        message.externalRequest.status = 'cancelled'
      }
    }
  }
  workspace.agentMode = mode
  workspace.externalAgent = mode === 'external' ? (agent ?? null) : null
  const resolveValue = () => {
    if (mode === 'external') {
      if (agent) {
        return `已交给外部 Agent「${agent.name}」处理；不会调用内置 AI。`
      }
      return '已切换外部 Agent，等待连接；需求会保存在本会话。' as const
    }
    return '已切换为内置 AI；待处理的外部需求已取消。' as const
  }
  pageEvent(workspace, resolveValue())
  return savePage(workspace)
}

export function queueExternalRequest(
  id: string,
  revision: number,
  text: string,
  regionId: string | null,
  referenceIds: string[],
  discussionVersionId?: string,
  agent?: PageAgentIdentity,
) {
  const workspace = writablePage(id, revision)
  const version = pageCurrent(workspace)
  if (
    agent &&
    (!agentIsConnected(agent.sessionId) || workspace.externalAgent?.sessionId !== agent.sessionId)
  ) {
    throw new Error('当前 Agent 未接管此会话')
  }
  if (workspace.agentMode !== 'external') {
    throw new Error('会话未开启外部 Agent 接管')
  }
  if (pendingExternalRequest(workspace)) {
    throw new Error('已有待处理需求，请等待回复或取消后再发送')
  }
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 6000 ||
    !Array.isArray(referenceIds) ||
    referenceIds.length > 2 ||
    referenceIds.some((id) => !workspace.versions.some((version2) => version2.id === id))
  ) {
    throw new Error('需求或引用版本无效')
  }
  if (regionId && !version.editor.regions.some((region) => region.id === regionId)) {
    throw new Error('区域已不存在')
  }
  const discussion = discussionSnapshot(workspace, discussionVersionId)
  const message = pageMessage('user', text.trim(), version.id)
  const skills = composeSkills('workspace', workspace.model)
  message.discussion = discussion
  message.regionId = regionId
  message.referenceIds = [...referenceIds]
  message.externalRequest = {
    status: 'pending',
    contextKey: pageContextKey(version, regionId, workspace),
  }
  message.skills = skills.skills.map((skill) => skill.name)
  message.skillSnapshot = skills.snapshot
  workspace.messages.push(message)
  workspace.composer = ''
  return savePage(workspace)
}

export function cancelExternalRequest(id: string, revision: number, agent?: PageAgentIdentity) {
  const workspace = writablePage(id, revision)
  const pending = pendingExternalRequest(workspace)
  if (agent && workspace.externalAgent?.sessionId !== agent.sessionId) {
    throw new Error('当前 Agent 未接管此会话')
  }
  if (!pending) {
    throw new Error('没有待处理的外部需求')
  }
  pending.externalRequest!.status = 'cancelled'
  pageEvent(workspace, '已取消外部需求，原消息保留；后续回复不会覆盖当前内容。')
  return savePage(workspace)
}

export function replyExternalRequest(
  id: string,
  revision: number,
  response: PageExternalReply,
  agent?: PageAgentIdentity,
) {
  const workspace = writablePage(id, revision)
  const version = pageCurrent(workspace)
  if (
    workspace.agentMode !== 'external' ||
    !agent ||
    !agentIsConnected(agent.sessionId) ||
    workspace.externalAgent?.sessionId !== agent.sessionId
  ) {
    throw new Error('当前 Agent 未接管此会话，请先连接；不会切换为内置 AI')
  }
  const request = workspace.messages.find(
    (message2) =>
      message2.id === response?.requestId && message2.externalRequest?.status === 'pending',
  )
  if (!request) {
    throw new Error('需求已完成、已取消或不存在，请读取会话确认，勿重复提交')
  }
  if (
    request.versionId !== version.id ||
    request.externalRequest!.contextKey !==
      pageContextKey(version, request.regionId ?? null, workspace) ||
    discussionIsStale(workspace, request.discussion)
  ) {
    throw new Error('需求发出后讨论图片、目标、版本、提示词或选区已改变，请取消旧需求后重新发送')
  }
  if (
    typeof response.reply !== 'string' ||
    !response.reply.trim() ||
    response.reply.length > 16000
  ) {
    throw new Error('回复须为 1～16000 字符')
  }
  if (
    response.understanding &&
    [response.understanding.goal, response.understanding.preserve].some(
      (text) => typeof text !== 'string' || text.length > 6000,
    )
  ) {
    throw new Error('目标记录格式无效')
  }
  const proposal = response.proposal
  if (proposal) {
    checkDraft(proposal.draft, workspace.model)
    if (
      typeof proposal.title !== 'string' ||
      !proposal.title.trim() ||
      proposal.title.length > 200 ||
      typeof proposal.warning !== 'string' ||
      proposal.warning.length > 4000
    ) {
      throw new Error('建议标题或风险说明无效')
    }
    validateExecution(workspace, proposal.execution)
  }
  if (response.understanding) {
    workspace.goal = response.understanding.goal
    workspace.preserve = response.understanding.preserve
    pageEvent(
      workspace,
      `目标：${workspace.goal || '未指定'}${workspace.preserve ? '\n保留：' + workspace.preserve : ''}`,
    )
  }
  const message = pageMessage('assistant', response.reply, version.id)
  message.author = { kind: 'external', name: agent.name }
  message.requestId = request.id
  message.regionId = request.regionId
  message.referenceIds = request.referenceIds
  message.discussion = request.discussion ? clone(request.discussion) : undefined
  message.skills = request.skills
  if (proposal) {
    const before = pageDraft(version, request.regionId ?? null)
    message.proposal = {
      regionId: request.regionId ?? null,
      title: proposal.title,
      warning: proposal.warning,
      changes: pageChanges(before, proposal.draft),
      status: 'pending',
      contextKey: pageContextKey(version, request.regionId ?? null, workspace),
      before: clone(before),
      after: clone(proposal.draft),
      execution: validateExecution(workspace, proposal.execution),
      previousAccepted: null,
    }
  }
  request.externalRequest!.status = 'completed'
  workspace.messages.push(message)
  return savePage(workspace)
}
