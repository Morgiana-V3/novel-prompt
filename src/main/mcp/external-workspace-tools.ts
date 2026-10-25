import { workspaceResult } from './workspace-result'
import type { DesktopBridge } from '../desktop'
import type { McpTool } from './server'
import type { PageExternalReply } from '../../shared/page-workspace'
import { pageCurrent, pageContextKey } from '../../shared/page-workspace'
import { readPage, pendingExternalRequest, replyExternalRequest, setPageAgent, cancelExternalRequest } from '../page-workspaces'
import { requireAgent, agentIsConnected } from '../agent-sessions'
import { inpaintTools } from './inpaint-tools'

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
    { name: 'cancel_workspace_request', title: '取消待处理的外部需求', description: '由接管此会话的 Agent 取消待处理需求，保留消息与已保存结果；不影响其他会话。',
      inputSchema: { type: 'object', properties: { id, revision }, required: ['id', 'revision'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceResult(cancelExternalRequest(String(a.id), Number(a.revision), requireAgent())))) },
    { name: 'set_workspace_agent', title: '设置会话处理方式', description: '后台选择 internal 或 external。external 将当前 MCP 连接绑定到会话；断开不转调内置 AI。不会打开窗口。已有其他在线 Agent 接管时拒绝抢占。',
      inputSchema: { type: 'object', properties: { id, revision, mode: { type: 'string', enum: ['internal', 'external'] } }, required: ['id', 'revision', 'mode'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceResult(setPageAgent(String(a.id), Number(a.revision), a.mode as 'internal' | 'external', requireAgent())))) },
    { name: 'get_workspace_context', title: '读取外部 Agent 待处理上下文', description: '读取待处理需求、完整提示词、参数、区域、历史引用和本轮冻结的 Skill。区域返回遮罩预览路径，可用 read_image 查看；完整聊天/旧方案另用 get_workspace。不会调用内置 AI、采纳或生成。',
      inputSchema: { type: 'object', properties: { id }, required: ['id'] }, annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (a, signal) => desktop.withWorkspace(String(a.id), async () => {
        const w = readPage(String(a.id)), v = pageCurrent(w), request = pendingExternalRequest(w)
        const region = v.editor.regions.find(r => r.id === request?.regionId)
        const prepare = inpaintTools().find(t => t.name === 'prepare_inpaint')!
        const preview = region && v.image ? JSON.parse(await prepare.run({ image_name: v.image.name, mask_base64: region.mask }, signal) as string) : null
        return JSON.stringify({ id: w.id, revision: w.revision, mode: w.agentMode ?? 'internal', agent: w.externalAgent,
          connected: agentIsConnected(w.externalAgent?.sessionId), request: request ? { id: request.id, text: request.text, versionId: request.versionId, regionId: request.regionId, referenceIds: request.referenceIds,
            stale: request.versionId !== v.id || request.externalRequest!.contextKey !== pageContextKey(v, request.regionId ?? null, w) } : null,
          goal: w.goal, preserve: w.preserve, model: w.model, currentVersionId: v.id, image: v.image, draft: v.editor.draft, params: v.editor.params, strength: v.editor.strength,
          execution: w.execution, regions: v.editor.regions.map(({ mask: _mask, accepted: _accepted, ...r }) => r), preview,
          references: w.versions.filter(v => request?.referenceIds?.includes(v.id)).map(v => ({ id: v.id, label: v.label, image: v.image, draft: v.generated?.draft ?? v.editor.draft })),
          skills: request?.skillSnapshot ?? null, skillNames: request?.skills ?? [],
          capabilities: { strength: { min: .01, max: 1 }, canAutoWakeAgent: false },
          instructions: '先阅读本轮 Skill、当前图片/选区与必要历史，再自行分析。reply_workspace_request 或 ui_reply_workspace_request 写回中文回复和可选完整方案；不调用 ui_send_workspace_message 之外的内置 AI 工具来代替本轮分析。采纳与生成是分开的操作。' })
      }) },
    { name: 'reply_workspace_request', title: '写回外部 Agent 回复和方案', description: '由已接管的 MCP 连接回复待处理需求。支持纯讨论、目标更新、区域方案与执行建议。差异由程序计算，保留完整记录，不自动采纳或生成；旧需求和重复回复会被拒绝。',
      inputSchema: { type: 'object', properties: { id, revision, response: EXTERNAL_RESPONSE_SCHEMA }, required: ['id', 'revision', 'response'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => JSON.stringify(workspaceResult(replyExternalRequest(String(a.id), Number(a.revision), a.response as PageExternalReply, requireAgent())))) }
  ]
}
