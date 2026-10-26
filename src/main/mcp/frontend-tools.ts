import type { DesktopBridge } from '../desktop'
import type { FrontendAction, FrontendRequest } from '../../shared/desktop'
import type { McpTool } from './server'
import { getSettings } from '../settings'
import { listImages } from '../nai/client'
import { runFrontend } from '../frontend-operations'
import { readPage } from '../page-workspaces'
import { requireAgent } from '../agent-sessions'
import { EXTERNAL_RESPONSE_SCHEMA } from './external-workspace-tools'

const ID = { type: 'string', description: '当前已打开工作台的 id；先用 ui_open_workspace 打开' }
const TOKEN = { type: 'string', description: '最新 get_app_state.desktop.token，界面变化时拒绝覆盖' }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const nonempty = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`缺少${label}`); return v }
export function frontendTools(desktop: DesktopBridge): McpTool[] {
  function tool(name: string, label: string, action: FrontendAction, description: string, properties: Record<string, unknown>, required: string[],
    validate: (a: Record<string, unknown>) => void = () => {}, gate?: () => string | null): McpTool {
    const guarded = !['open', 'create'].includes(action)
    return { name, title: `前台 · ${label}`, description: `【前台可视化】${description} 操作会在应用窗口中执行并等待界面反馈；可穿插后台读取，不要混用后台写入。首次操作先读 agent_guide(topic=workflows)。`,
      inputSchema: { type: 'object', properties: { ...(guarded ? { id: ID, expected_token: TOKEN } : {}), step_delay_ms: { type: 'integer', minimum: 0, maximum: 5000, description: '每个可见步骤的停留时间，默认 300 毫秒；演示可设为 2000' }, ...properties }, required: [...(guarded ? ['id', 'expected_token'] : []), ...required] },
      annotations: { ...WRITE, openWorldHint: !!gate }, gate,
      run: async (a, signal, report = () => {}) => {
        if (guarded) { nonempty(a.id, '会话 id'); nonempty(a.expected_token, '界面 token') }
        if (a.step_delay_ms !== undefined && (!Number.isInteger(a.step_delay_ms) || Number(a.step_delay_ms) < 0 || Number(a.step_delay_ms) > 5000)) throw new Error('步骤停留时间须为 0～5000 毫秒的整数')
        validate(a)
        if (action === 'send' && readPage(String(a.id)).agentMode !== 'external') {
          if (!getSettings().mcpAllowAi || !getSettings().apiKey) throw new Error('请开启允许 Agent 调用 AI 并配置 AI 服务')
        }
        if (action === 'agent' || action === 'reply' || action === 'external-cancel') requireAgent()
        const request = { ...a, action, label } as unknown as FrontendRequest
        request.agent_session = requireAgent().sessionId
        if (action === 'create' && a.source === 'image') {
          request.image = listImages().find(i => i.name === a.image_name)
          if (!request.image) throw new Error('图库图片不存在')
        }
        return runFrontend(action, typeof a.id === 'string' ? a.id : undefined, label, signal, report, async (actionId, abort) => {
          const cancel = () => desktop.cancelVisibleAction(actionId)
          abort.addEventListener('abort', cancel, { once: true })
          try {
            report(`前台：${label}`)
            return JSON.stringify(await desktop.request('frontend', { ...request, actionId }, true, abort))
          } finally { abort.removeEventListener('abort', cancel) }
        })
      } }
  }
  return [
    tool('ui_edit_workspace_config', '编辑下一版生图配置', 'config', '从底部入口打开独立的下一版配置。config_action=begin 开始；update 修改同一表单的提示词或参数；save 保存并返回原查看面板；cancel 放弃本次未保存修改并返回。无需 AI 建议，不生成图片，也不改变查看、采用版本或图片快照。操作前读取最新 token；只能继续本连接打开的编辑，用户手动操作后拒绝覆盖。get_app_state.workspace.config 返回当前表单和禁用原因。',
      {config_action:{type:'string',enum:['begin','update','save','cancel']},patch:{type:'object',additionalProperties:false,properties:{draft:{type:'object',additionalProperties:false,properties:{base:{type:'string'},negative:{type:'string'},characters:{type:'array',maxItems:6,items:{type:'object',properties:{prompt:{type:'string'},negative:{type:'string'},position:{type:'string'}},required:['prompt','negative'],additionalProperties:false}}}},params:{type:'object',additionalProperties:false,properties:{count:{type:'integer',enum:[1,2,4]},qualityTags:{type:'boolean'},ucPreset:{type:'string',enum:['heavy','light','human','none']},width:{type:'integer'},height:{type:'integer'},steps:{type:'integer'},scale:{type:'number'},seed:{type:['integer','null']},cfgRescale:{type:'number'},sampler:{type:'string'},noiseSchedule:{type:'string'}}},strength:{type:'number'}}}},['config_action'],a=>{
        if(!['begin','update','save','cancel'].includes(String(a.config_action)))throw new Error('未知配置操作')
        if(a.config_action==='update'&&(!a.patch||typeof a.patch!=='object'||Array.isArray(a.patch)))throw new Error('修改配置需要 patch')
        if(a.config_action!=='update'&&a.patch!==undefined)throw new Error('仅 update 可传 patch')
      }),
    tool('ui_cancel_workspace_request', '取消外部需求', 'external-cancel', '取消当前待处理的外部需求并显示结果；保留原始消息和修改记录。', {}, []),
    tool('ui_set_workspace_agent', '设置会话处理方式', 'agent', '显示并切换内置 AI / 外部 Agent。external 绑定当前 MCP 连接，断开后等待连接，不回退 DeepSeek。',
      { mode: { type: 'string', enum: ['internal', 'external'] } }, ['mode'], a => { if (!['internal', 'external'].includes(String(a.mode))) throw new Error('未知的处理方式') }),
    tool('ui_reply_workspace_request', '展示外部 Agent 回复', 'reply', '把当前 Agent 自己的回复和可选方案写入右侧对话，并展示完整修改对比。使用 get_workspace_context 的 request.id；无需配置内置 AI，不自动采纳或生成。',
      { response: EXTERNAL_RESPONSE_SCHEMA }, ['response']),
    tool('ui_open_workspace', '打开工作台', 'open', '显示应用并打开指定会话。保留未发送输入，正在编辑时拒绝离开。', { id: ID }, ['id'], a => { nonempty(a.id, '会话 id') }),
    tool('ui_create_workspace', '新建会话', 'create', '显示新建会话表单，填写名称和来源，再通过界面的开始会话流程创建。',
      { title: { type: 'string' }, source: { type: 'string', enum: ['blank', 'current', 'image'] }, image_name: { type: 'string' } }, ['title', 'source'], a => {
        if (typeof a.title !== 'string' || a.title.length > 100 || !['blank', 'current', 'image'].includes(String(a.source))) throw new Error('会话名称或来源无效')
      }),
    tool('ui_view_workspace', '查看项目内容', 'view', '工作台在界面称为创作项目；pane=prompt 为完整生图配置（提示词与参数），changes 仅展示变化项，images 展示当前版本组的候选缩略图；选择查看不会采用，suggestions 是兼容入口：展开对话中对应方案，保持当前面板，focusedProposalId 返回定位的方案。所有面板跟随同一个查看版本。version_id 是候选 id，省略保留当前查看对象；只查看，不采用。changes 面板可传 compare_version_id 指定另一个候选作为参照，空字符串恢复生成来源；不改变查看或采用对象。',
      { pane: { type: 'string', enum: ['canvas', 'prompt', 'changes', 'images', 'suggestions', 'history'] }, version_id: { type: 'string' }, compare_version_id: { type: 'string' } }, ['pane'], a => {
        if (!['canvas', 'prompt', 'changes', 'images', 'suggestions', 'history'].includes(String(a.pane))) throw new Error('未知工作台页面')
        if (a.compare_version_id !== undefined && (typeof a.compare_version_id !== 'string' || a.pane !== 'changes')) throw new Error('对比对象仅用于修改对比面板')
      }),
    tool('ui_set_workspace_input', '填写讨论内容', 'compose', '在可见的工作台输入框填写需求，选择区域和参考版本。只填入，不发送、不调用 AI；随后使用 ui_send_workspace_message。',
      { text: { type: 'string' }, region_id: { type: ['string', 'null'] }, reference_ids: { type: 'array', items: { type: 'string' }, maxItems: 2 } }, ['text'], a => {
        if (typeof a.text !== 'string' || a.text.length > 6000) throw new Error('讨论内容须为不超过 6000 字的文本')
        if (a.reference_ids !== undefined && (!Array.isArray(a.reference_ids) || a.reference_ids.length > 2 || a.reference_ids.some(v => typeof v !== 'string'))) throw new Error('最多引用两个版本')
      }),
    tool('ui_send_workspace_message', '提交讨论', 'send', '提交当前输入。内置模式调用配置的 AI；外部接管模式只保存待处理需求，不调用内置 AI，不自动唤醒外部 Agent。随后读取 get_workspace_context 并写回回复。不会自动采纳或生图。', {}, [], undefined, () => null),
    tool('ui_add_workspace_region', '绘制区域批注', 'region', '打开前台选区编辑器，用原图像素矩形绘制一个新区域，显示批注后保存回工作台。保留已有区域；不调用 AI 或生成。返回状态包含新区域 id。',
      { rectangles: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['x', 'y', 'width', 'height'] } }, instruction: { type: 'string' }, target: { type: ['integer', 'null'] } }, ['rectangles', 'instruction'], a => {
        if (typeof a.instruction !== 'string' || !a.instruction.trim() || a.instruction.length > 6000) throw new Error('请填写有效区域批注')
        if (!Array.isArray(a.rectangles) || !a.rectangles.length || a.rectangles.length > 32 || a.rectangles.some(r => !r || !['x', 'y', 'width', 'height'].every(k => Number.isInteger(r[k])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0)) throw new Error('选区矩形无效')
        if (a.target != null && (!Number.isInteger(a.target) || Number(a.target) < 0)) throw new Error('角色索引无效')
      }),
    tool('ui_review_workspace', '处理建议或版本', 'review', '先显示对应建议及修改对比，再采纳、拒绝或撤销。decision=switch 显示历史并从指定版本继续；不生图。',
      { decision: { type: 'string', enum: ['accept', 'reject', 'undo', 'switch'] }, message_id: { type: 'string' }, version_id: { type: 'string' } }, ['decision'], a => {
        if (!['accept', 'reject', 'undo', 'switch'].includes(String(a.decision))) throw new Error('未知审核操作')
        nonempty(a.decision === 'switch' ? a.version_id : a.message_id, '目标 id')
      }),
    tool('ui_generate_workspace', '执行生成或重绘', 'generate', '在前台选择整图生成或已有区域重绘，显示遮罩、执行方式和生成进度，结果进入工作台历史。只使用已采纳稿。必须取得用户生成授权，强制免费检查。',
      { kind: { type: 'string', enum: ['generate', 'inpaint'] }, region_id: { type: 'string' }, confirm: { type: 'boolean' } }, ['kind', 'confirm'], a => {
        if (a.confirm !== true) throw new Error('必须获得用户生成授权并传 confirm:true')
        if (!['generate', 'inpaint'].includes(String(a.kind))) throw new Error('未知生成方式')
        if (a.kind === 'inpaint') nonempty(a.region_id, '重绘区域 id')
      }, () => !getSettings().mcpAllowGenerate ? '请先开启允许 Agent 生图' : !getSettings().naiToken ? '请先配置 NovelAI Token' : null)
  ]
}
