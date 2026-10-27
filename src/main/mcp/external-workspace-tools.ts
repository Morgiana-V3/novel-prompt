import { workspaceReceipt } from './workspace-read'
import { contextSkills, SKILLS_READ_SCHEMA } from './skills-cache'
import { candidatePage, CANDIDATE_PAGE_SCHEMA } from './candidate-page'
import type { DesktopBridge } from '../desktop'
import type { McpTool } from './server'
import type { PageExternalReply } from '../../shared/page-workspace'
import { pageCurrent, pageContextKey, pageComparison, pageGroups } from '../../shared/page-workspace'
import { readPage, listPendingPageRequests, editPage, queueExternalRequest, pendingExternalRequest, replyExternalRequest, setPageAgent, cancelExternalRequest, discussionSnapshot, discussionIsStale } from '../page-workspaces'
import { requireAgent, agentIsConnected, agentActivity, reportAgentActivity } from '../agent-sessions'
import { workspaceInpaintPreview, workspaceRectangleMask } from './inpaint-tools'
import { randomUUID } from 'node:crypto'

const draft = { type: 'object', properties: { base: { type: 'string' }, negative: { type: 'string' }, characters: { type: 'array', items: { type: 'object', properties: { prompt: { type: 'string' }, negative: { type: 'string' }, position: { type: 'string' } }, required: ['prompt'] } } }, required: ['base', 'negative', 'characters'] }
export const EXTERNAL_RESPONSE_SCHEMA = { type: 'object', properties: {
  requestId: { type: 'string', description: 'get_workspace_context 返回的待处理用户消息 id' }, reply: { type: 'string', maxLength: 16000 },
  understanding: { type: ['object', 'null'], properties: { goal: { type: 'string' }, preserve: { type: 'string' } }, required: ['goal', 'preserve'] },
  proposal: { type: ['object', 'null'], properties: { title: { type: 'string' }, warning: { type: 'string' }, draft,
    execution: { type: 'object', properties: { kind: { type: 'string', enum: ['generate', 'inpaint'] }, regionId: { type: ['string', 'null'] } }, required: ['kind', 'regionId'] } }, required: ['title', 'warning', 'draft', 'execution'] }
}, required: ['requestId', 'reply'] }
export function externalWorkspaceTools(desktop: DesktopBridge): McpTool[] {
  const id = { type: 'string' }, revision = { type: 'integer' }
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  return [
    { name: 'report_workspace_progress', title: '报告外部 Agent 处理状态', description: '已接管 Agent 在开始处理本轮需求时报告 processing，可附简短进度。120 秒未续报自动回到等待，断线立即失效；waiting 主动结束处理状态。不会启动模型或自动回复。',
      inputSchema: { type: 'object', properties: { id, revision, request_id: id, phase: { type: 'string', enum: ['processing', 'waiting'] }, message: { type: 'string', maxLength: 200 } }, required: ['id', 'revision', 'request_id', 'phase'] }, annotations: write,
      run: async a => {
        const w = readPage(String(a.id)), agent = requireAgent(), request = pendingExternalRequest(w)
        if (w.agentMode !== 'external' || w.externalAgent?.sessionId !== agent.sessionId) throw new Error('当前 Agent 未接管此会话')
        if (w.revision !== a.revision) throw new Error('会话已变化，请重新读取后继续')
        if (!request || request.id !== a.request_id) throw new Error('需求已完成、已取消或不存在')
        if (request.externalRequest!.contextKey !== pageContextKey(pageCurrent(w), request.regionId ?? null, w) || discussionIsStale(w, request.discussion)) throw new Error('需求上下文已改变，请重新读取')
        const activity = reportAgentActivity(w.id, request.id, a.phase as 'processing' | 'waiting', typeof a.message === 'string' ? a.message : '正在分析本轮需求')
        return JSON.stringify({ id: w.id, requestId: request.id, phase: a.phase, activity, canAutoWakeAgent: false })
      } },
    { name: 'submit_workspace_request', title: '提交外部工作台需求', description: '由已接管的 Agent 后台提交用户明确要求的讨论，冻结讨论图片与 Skill；discussion_version_id 默认已采用候选。只保存待处理需求，不调用 AI、不自动唤醒。不会覆盖界面未发送草稿。',
      inputSchema: { type: 'object', properties: { id, revision, text: { type: 'string', maxLength: 6000 }, discussion_version_id: id, region_id: { type: ['string', 'null'] }, reference_ids: { type: 'array', items: id, maxItems: 2 } }, required: ['id', 'revision', 'text'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => {
        const w = readPage(String(a.id))
        if (w.composer.trim()) throw new Error('会话有未发送草稿，请先在界面处理，不能覆盖')
        return JSON.stringify(workspaceReceipt(queueExternalRequest(w.id, Number(a.revision), a.text as string, a.region_id as string ?? null, a.reference_ids as string[] ?? [], a.discussion_version_id as string | undefined, requireAgent())))
      }) },
    { name: 'add_workspace_region', title: '添加工作台区域批注', description: '后台向已采用图片添加矩形并集区域，保留已有批注。必须指定 version_id 与 revision，防止误改查看中的历史图。返回 addedRegionId；不调用 AI、不生成。',
      inputSchema: { type: 'object', properties: { id, revision, version_id: id, instruction: { type: 'string', maxLength: 6000 }, target: { type: ['integer', 'null'] }, rectangles: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['x', 'y', 'width', 'height'] } } }, required: ['id', 'revision', 'version_id', 'instruction', 'rectangles'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => {
        const w = readPage(String(a.id)), v = pageCurrent(w), agent = requireAgent()
        if (w.agentMode === 'external' && w.externalAgent?.sessionId !== agent.sessionId) throw new Error('当前 Agent 未接管此会话')
        if (w.revision !== a.revision) throw new Error('会话已变化，请重新读取后继续')
        if (v.id !== a.version_id) throw new Error('区域只能添加到已采用版本，请先明确采用目标图片')
        if (!v.image || v.image.missing) throw new Error('当前版本没有可读取的图片')
        if (typeof a.instruction !== 'string' || !a.instruction.trim() || a.instruction.length > 6000) throw new Error('请填写有效区域批注')
        if (v.editor.regions.length >= 16) throw new Error('最多保留 16 个区域')
        const regionId = randomUUID()
        let label = 'AA'
        for (let i = 0; v.editor.regions.some(r => r.label === label); i++) label = 'A'+String.fromCharCode(66+i)
        const mask = workspaceRectangleMask(v.image.name, a.rectangles)
        const editor = { ...v.editor, regions: [...v.editor.regions, { id: regionId, label, instruction: a.instruction.trim(), target: a.target as number ?? null, anchor: null, annotated: true, mask, accepted: null }] }
        return JSON.stringify({ ...workspaceReceipt(editPage(w.id, Number(a.revision), { type: 'editor', versionId: v.id, editor })), addedRegionId: regionId })
      }) },
    { name: 'compare_workspace_versions', title: '读取指定版本差异', description: '只读比较两个候选的冻结图片、提示词和参数，不采用、不切换界面。version_id 为查看候选，compare_version_id 省略时使用其实际生成来源。起始稿不代表导入图实际生成参数。',
      inputSchema: { type: 'object', properties: { id, version_id: id, compare_version_id: id }, required: ['id', 'version_id'] }, annotations: { readOnlyHint: true, openWorldHint: false },
      run: async a => {
        const w = readPage(String(a.id)), c = pageComparison(w, String(a.version_id), a.compare_version_id as string | undefined)
        return JSON.stringify({ id: w.id, revision: w.revision, adoptedVersionId: w.currentVersionId,
          viewed: discussionSnapshot(w, c.version!.id), comparison: c.source ? discussionSnapshot(w, c.source.id) : null,
          mode: a.compare_version_id ? 'specified' : 'source', changes: c.changes,
          comparable: !!c.snapshot && !!c.before, parameters: { before: c.before?.params ?? null, after: c.snapshot?.params ?? null } })
      } },
    { name: 'list_workspace_requests', title: '查看待处理外部需求', description: '只读待处理需求索引，包含所属会话、接管连接与是否失效；不接管、不自动唤醒。处理前用 get_workspace_context 读取完整冻结上下文。',
      inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false },
      run: async () => JSON.stringify({ items: listPendingPageRequests().map(p => ({ ...p, connected: agentIsConnected(p.agent?.sessionId) })), canAutoWakeAgent: false }) },
    { name: 'cancel_workspace_request', title: '取消待处理的外部需求', description: '由接管此会话的 Agent 取消待处理需求，保留消息与已保存结果；不影响其他会话。',
      inputSchema: { type: 'object', properties: { id, revision }, required: ['id', 'revision'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceReceipt(cancelExternalRequest(String(a.id), Number(a.revision), requireAgent())))) },
    { name: 'set_workspace_agent', title: '设置会话处理方式', description: '后台选择 internal 或 external。external 将当前 MCP 连接绑定到会话；断开不转调内置 AI。不会打开窗口。已有其他在线 Agent 接管时拒绝抢占。',
      inputSchema: { type: 'object', properties: { id, revision, mode: { type: 'string', enum: ['internal', 'external'] } }, required: ['id', 'revision', 'mode'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceReceipt(setPageAgent(String(a.id), Number(a.revision), a.mode as 'internal' | 'external', requireAgent())))) },
    { name: 'get_workspace_context', title: '读取外部 Agent 待处理上下文', description: '读取待处理需求、完整提示词、参数、区域和冻结规则目录；默认只返回规则总则与最近 10 个候选。先读目录，再按 skills_task/skills_ids 补读本轮相关冻结正文；rules_only:true 只读规则。候选通过 version_limit/before_version_id 分页，当前蓝本信息始终单独提供。区域返回遮罩预览路径，可用 read_image 查看；历史另用 get_workspace。不会调用内置 AI、采纳或生成。',
      inputSchema: { type: 'object', properties: { id, ...SKILLS_READ_SCHEMA, ...CANDIDATE_PAGE_SCHEMA }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (a, signal) => desktop.withWorkspace(String(a.id), async () => {
        const w = readPage(String(a.id)), v = pageCurrent(w), request = pendingExternalRequest(w)
        if (a.history_revision !== undefined && a.history_revision !== w.revision) throw Error('任务已更新，请重新读取当前上下文')
        if (a.rules_only === true) {
          if (a.before_version_id !== undefined || a.version_limit !== undefined) throw Error('只读规则时不能同时请求候选分页')
          return JSON.stringify({ id: w.id, revision: w.revision, model: w.model, requestId: request?.id ?? null, skills: contextSkills(request?.skillSnapshot, a) })
        }
        const candidates = candidatePage(w.versions, a, w.revision, w.versions.length)
        const ids = new Set(candidates.items.map(v => v.id))
        const discussion = request?.discussion ?? discussionSnapshot(w, request?.versionId)
        const region = v.editor.regions.find(r => r.id === request?.regionId)
        const preview = region && v.image && !v.image.missing ? JSON.parse(await workspaceInpaintPreview(v.image.name, region.mask, signal)) : null
        return JSON.stringify({ id: w.id, revision: w.revision, mode: w.agentMode ?? 'internal', agent: w.externalAgent,
          connected: agentIsConnected(w.externalAgent?.sessionId), request: request ? { id: request.id, text: request.text, versionId: request.versionId, regionId: request.regionId, referenceIds: request.referenceIds,
            discussionVersionId: discussion.versionId,
            stale: request.versionId !== v.id || request.externalRequest!.contextKey !== pageContextKey(v, request.regionId ?? null, w) || discussionIsStale(w, request.discussion) } : null,
          discussion, editTarget: { versionId: request?.versionId ?? v.id, label: w.versions.find(v => v.id === request?.versionId)?.label ?? v.label },
          goal: w.goal, preserve: w.preserve, model: w.model, currentVersionId: v.id, image: v.image, draft: v.editor.draft, params: v.editor.params, strength: v.editor.strength,
          adoptedVersionId: v.id, groups: pageGroups(w).filter(g => g.versions.some(v => ids.has(v.id))).map(g => ({ id: g.id, label: g.label, candidateIds: g.versions.filter(v => ids.has(v.id)).map(v => v.id), totalCandidates: g.versions.length, partial: g.versions.some(v => !ids.has(v.id)) })),
          latestGeneratedVersionId: w.latestGeneratedVersionId, candidatesPage: candidates.page, candidates: candidates.items.map(r => ({ id: r.id, groupId: r.groupId ?? r.id, label: r.label, adopted: r.id === w.currentVersionId, image: r.image })),
          execution: w.execution, regions: v.editor.regions.map(({ mask: _mask, accepted: _accepted, ...r }) => r), preview,
          references: w.versions.filter(v => request?.referenceIds?.includes(v.id)).map(v => ({ id: v.id, label: v.label, image: v.image, draft: v.generated?.draft ?? v.editor.draft })),
          skills: contextSkills(request?.skillSnapshot, a), skillNames: request?.skills ?? [],
          processing: { state: w.agentMode !== 'external' ? 'internal' : !agentIsConnected(w.externalAgent?.sessionId) ? 'disconnected' : agentActivity(w.externalAgent?.sessionId, w.id, request?.id) ? 'processing' : request ? 'awaiting_agent' : 'idle', activity: agentActivity(w.externalAgent?.sessionId, w.id, request?.id), canAutoWakeAgent: false,
            nextAction: request ? '读取本轮上下文后回复；连接本身不会启动模型。' : '等待用户需求。' },
          capabilities: { strength: { min: .01, max: 1 }, canAutoWakeAgent: false },
          instructions: '先读总则和目录，用 skills_task/skills_ids 补齐本轮相关冻结正文（可 rules_only:true）；检查 missingRequiredIds 并确认正文仍在当前上下文，然后阅读 discussion.image 所指的讨论图片、当前采用图片/选区与必要历史，再自行分析。discussion 是发送时冻结的讨论对象，不随画布切换；editTarget 是修改目标。discussion.recipe.source=generated 表示实际生成记录，initial 仅是会话起始稿和设置，不能当作导入图片实际使用的生成参数。两者不同时，不能将候选图当成已采用底图，proposal.draft 仍基于顶层 draft；要在候选图上重绘须先由用户采用该版本。reply_workspace_request 或 ui_reply_workspace_request 写回中文回复和可选完整方案；不调用内置 AI 工具来代替本轮分析。采纳与生成是分开的操作。' })
      }) },
    { name: 'reply_workspace_request', title: '写回外部 Agent 回复和方案', description: '由已接管的 MCP 连接回复待处理需求。支持纯讨论、目标更新、区域方案与执行建议。差异由程序计算，保留完整记录，不自动采纳或生成；旧需求和重复回复会被拒绝。',
      inputSchema: { type: 'object', properties: { id, revision, response: EXTERNAL_RESPONSE_SCHEMA }, required: ['id', 'revision', 'response'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceReceipt(replyExternalRequest(String(a.id), Number(a.revision), a.response as PageExternalReply, requireAgent())))) }
  ]
}
