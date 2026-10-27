import type { FrontendAction, FrontendRequest } from '../../../shared/contracts/desktop'
import { WORKSPACE_CONFIG_SCHEMA } from '../../../shared/workspace/config'
import { listImages } from '../../modules/images/access'
import { getSettings } from '../../modules/settings/service'
import { requireAgent } from '../../modules/workspace/agent-sessions'
import { readPage } from '../../modules/workspace/repository'
import type { DesktopBridge } from '../desktop/bridge'
import { runFrontend } from '../desktop/frontend-operations'
import { EXTERNAL_RESPONSE_SCHEMA } from './external-workspace-tools'
import type { McpTool } from './types'

const ID = { type: 'string', description: '当前已打开工作台的 id；先用 ui_open_workspace 打开' }
const TOKEN = {
  type: 'string',
  description: '最新 get_app_state.desktop.token，界面变化时拒绝覆盖',
}
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const REGION_FIELDS = {
  instruction: { type: 'string', minLength: 1, maxLength: 6000 },
  target: { type: ['integer', 'null'], minimum: 0 },
  rectangles: {
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
        width: { type: 'integer', minimum: 1 },
        height: { type: 'integer', minimum: 1 },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
}
const nonempty = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少${label}`)
  }
  return value
}
export function frontendTools(desktop: DesktopBridge): McpTool[] {
  function tool(
    name: string,
    label: string,
    action: FrontendAction,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    validate: (argumentsRecord: Record<string, unknown>) => void = () => {},
    gate?: () => string | null,
  ): McpTool {
    const guarded = !['open', 'create'].includes(action)
    return {
      name,
      title: `前台 · ${label}`,
      description: `【前台可视化】${description} 操作会在应用窗口中执行并等待界面反馈；可穿插后台读取，不要混用后台写入。首次操作先读 agent_guide(topic=workflows)。`,
      inputSchema: {
        type: 'object',
        properties: {
          ...(guarded ? { id: ID, expected_token: TOKEN } : {}),
          step_delay_ms: {
            type: 'integer',
            minimum: 0,
            maximum: 5000,
            description: '每个可见步骤的停留时间，默认 300 毫秒；演示可设为 2000',
          },
          ...properties,
        },
        required: [...(guarded ? ['id', 'expected_token'] : []), ...required],
      },
      annotations: {
        ...WRITE,
        destructiveHint: ['delete-image', 'delete-project', 'region-delete'].includes(action),
        openWorldHint: !!gate,
      },
      gate,
      run: async (argumentsRecord, signal, report = () => {}) => {
        if (guarded) {
          nonempty(argumentsRecord.id, '会话 id')
          nonempty(argumentsRecord.expected_token, '界面 token')
        }
        if (
          argumentsRecord.step_delay_ms !== undefined &&
          (!Number.isInteger(argumentsRecord.step_delay_ms) ||
            Number(argumentsRecord.step_delay_ms) < 0 ||
            Number(argumentsRecord.step_delay_ms) > 5000)
        ) {
          throw new Error('步骤停留时间须为 0～5000 毫秒的整数')
        }
        validate(argumentsRecord)
        if (
          [
            'rename',
            'delete-image',
            'delete-project',
            'region',
            'region-update',
            'region-delete',
          ].includes(action)
        ) {
          const workspace = readPage(String(argumentsRecord.id))
          if (
            workspace.agentMode === 'external' &&
            workspace.externalAgent?.sessionId !== requireAgent().sessionId
          ) {
            throw new Error('当前 Agent 未接管此会话')
          }
        }
        if (action === 'send' && readPage(String(argumentsRecord.id)).agentMode !== 'external') {
          if (!getSettings().mcpAllowAi || !getSettings().apiKey) {
            throw new Error('请开启允许 Agent 调用 AI 并配置 AI 服务')
          }
        }
        if (action === 'agent' || action === 'reply' || action === 'external-cancel') {
          requireAgent()
        }
        const request = { ...argumentsRecord, action, label } as unknown as FrontendRequest
        request.agent_session = requireAgent().sessionId
        if (action === 'create' && argumentsRecord.source === 'image') {
          request.image = listImages().find((image) => image.name === argumentsRecord.image_name)
          if (!request.image) {
            throw new Error('图库图片不存在')
          }
        }
        return runFrontend(
          action,
          typeof argumentsRecord.id === 'string' ? argumentsRecord.id : undefined,
          label,
          signal,
          report,
          async (actionId, abort) => {
            const cancel = () => desktop.cancelVisibleAction(actionId)
            abort.addEventListener('abort', cancel, { once: true })
            try {
              report(`前台：${label}`)
              return JSON.stringify(
                await desktop.request('frontend', { ...request, actionId }, true, abort),
              )
            } finally {
              abort.removeEventListener('abort', cancel)
            }
          },
        )
      },
    }
  }
  return [
    tool(
      'ui_update_workspace_region',
      '修改已有区域',
      'region-update',
      '在选区编辑器中定位已采用候选的指定区域，修改批注、目标角色或替换遮罩并保存。保留区域 id 与其他区域；省略字段保持原值。取消保存前的步骤不写入。不会生成图片。version_id 必须是已采用候选。',
      { version_id: { type: 'string' }, region_id: { type: 'string' }, ...REGION_FIELDS },
      ['version_id', 'region_id'],
      (argumentsRecord) => {
        nonempty(argumentsRecord.version_id, '候选 id')
        nonempty(argumentsRecord.region_id, '区域 id')
        if (
          ![argumentsRecord.instruction, argumentsRecord.target, argumentsRecord.rectangles].some(
            (value) => value !== undefined,
          )
        ) {
          throw new Error('请提供要修改的区域字段')
        }
        if (argumentsRecord.instruction !== undefined) {
          nonempty(argumentsRecord.instruction, '区域批注')
        }
      },
    ),
    tool(
      'ui_delete_workspace_region',
      '删除已有区域',
      'region-delete',
      '在选区编辑器中定位指定区域并展示删除步骤，然后删除该区域的遮罩与批注。保留其他区域、图片和历史；不生成。须已获用户授权且 confirm:true，version_id 必须是已采用候选。',
      {
        version_id: { type: 'string' },
        region_id: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      ['version_id', 'region_id', 'confirm'],
      (argumentsRecord) => {
        nonempty(argumentsRecord.version_id, '候选 id')
        nonempty(argumentsRecord.region_id, '区域 id')
        if (argumentsRecord.confirm !== true) {
          throw new Error('删除区域须有用户授权并传 confirm:true')
        }
      },
    ),
    tool(
      'ui_rename_workspace',
      '重命名项目',
      'rename',
      '在项目标题处展示并保存新名称，不改变提示词。',
      { title: { type: 'string', minLength: 1, maxLength: 100 } },
      ['title'],
      (argumentsRecord) => {
        if (
          typeof argumentsRecord.title !== 'string' ||
          !argumentsRecord.title.trim() ||
          argumentsRecord.title.length > 100
        ) {
          throw new Error('项目名称须为 1～100 字符')
        }
      },
    ),
    tool(
      'ui_delete_workspace_image',
      '删除指定候选图片',
      'delete-image',
      '在工作台图库定位指定候选，展示删除提示后清理图片。保留提示词和历史，其他项目引用的文件保留。须先获用户删除授权。',
      { version_id: { type: 'string' }, confirm: { type: 'boolean' } },
      ['version_id', 'confirm'],
      (argumentsRecord) => {
        nonempty(argumentsRecord.version_id, '候选 id')
        if (argumentsRecord.confirm !== true) {
          throw new Error('删除须有用户授权并传 confirm:true')
        }
      },
    ),
    tool(
      'ui_delete_workspace',
      '删除项目',
      'delete-project',
      '在项目列表展示目标及删除提示，然后归档记录、清理所属图片。共享文件保留。须先获用户删除授权。',
      { confirm: { type: 'boolean' } },
      ['confirm'],
      (argumentsRecord) => {
        if (argumentsRecord.confirm !== true) {
          throw new Error('删除须有用户授权并传 confirm:true')
        }
      },
    ),
    tool(
      'ui_edit_workspace_config',
      '编辑下一版生图配置',
      'config',
      '从底部入口打开独立的下一版配置。config_action=begin 开始；resume 显式接续已断线 Agent 的草稿（不保存）；update 修改同一表单的提示词或参数；save 保存并返回原查看面板；cancel 放弃未保存修改。无需 AI 建议，不生成图片，也不改变查看、采用版本或图片快照。先读取最新 token；用户手动操作后拒绝覆盖，也不能接续其他在线 Agent 的编辑。get_app_state.desktop.workspace.config 返回当前表单，connection.workspace.editor.canResume 标记可否接续。',
      {
        config_action: { type: 'string', enum: ['begin', 'resume', 'update', 'save', 'cancel'] },
        patch: WORKSPACE_CONFIG_SCHEMA,
      },
      ['config_action'],
      (argumentsRecord) => {
        if (
          !['begin', 'resume', 'update', 'save', 'cancel'].includes(
            String(argumentsRecord.config_action),
          )
        ) {
          throw new Error('未知配置操作')
        }
        if (
          argumentsRecord.config_action === 'update' &&
          (!argumentsRecord.patch ||
            typeof argumentsRecord.patch !== 'object' ||
            Array.isArray(argumentsRecord.patch))
        ) {
          throw new Error('修改配置需要 patch')
        }
        if (argumentsRecord.config_action !== 'update' && argumentsRecord.patch !== undefined) {
          throw new Error('仅 update 可传 patch')
        }
      },
    ),
    tool(
      'ui_cancel_workspace_request',
      '取消外部需求',
      'external-cancel',
      '取消当前待处理的外部需求并显示结果；保留原始消息和修改记录。',
      {},
      [],
    ),
    tool(
      'ui_set_workspace_agent',
      '设置会话处理方式',
      'agent',
      '显示并切换内置 AI / 外部 Agent。external 绑定当前 MCP 连接，断开后等待连接，不回退 DeepSeek。',
      { mode: { type: 'string', enum: ['internal', 'external'] } },
      ['mode'],
      (argumentsRecord) => {
        if (!['internal', 'external'].includes(String(argumentsRecord.mode))) {
          throw new Error('未知的处理方式')
        }
      },
    ),
    tool(
      'ui_reply_workspace_request',
      '展示外部 Agent 回复',
      'reply',
      '把当前 Agent 自己的回复和可选方案写入右侧对话，并展示完整修改对比。使用 get_workspace_context 的 request.id；无需配置内置 AI，不自动采纳或生成。',
      { response: EXTERNAL_RESPONSE_SCHEMA },
      ['response'],
    ),
    tool(
      'ui_open_workspace',
      '打开工作台',
      'open',
      '显示应用并打开指定会话。保留未发送输入，正在编辑时拒绝离开。',
      { id: ID },
      ['id'],
      (argumentsRecord) => {
        nonempty(argumentsRecord.id, '会话 id')
      },
    ),
    tool(
      'ui_create_workspace',
      '新建会话',
      'create',
      '显示新建会话表单，填写名称和来源，再通过界面的开始会话流程创建。',
      {
        title: { type: 'string' },
        source: { type: 'string', enum: ['blank', 'current', 'image'] },
        image_name: { type: 'string' },
      },
      ['title', 'source'],
      (argumentsRecord) => {
        if (
          typeof argumentsRecord.title !== 'string' ||
          argumentsRecord.title.length > 100 ||
          !['blank', 'current', 'image'].includes(String(argumentsRecord.source))
        ) {
          throw new Error('会话名称或来源无效')
        }
      },
    ),
    tool(
      'ui_view_workspace',
      '查看项目内容',
      'view',
      '工作台在界面称为创作项目；pane=prompt 为完整生图配置（提示词与参数），changes 仅展示变化项，images 展示当前版本组的候选缩略图；选择查看不会采用，suggestions 是兼容入口：展开对话中对应方案，保持当前面板，focusedProposalId 返回定位的方案。所有面板跟随同一个查看版本。version_id 是候选 id，省略保留当前查看对象；只查看，不采用。changes 面板可传 compare_version_id 指定另一个候选作为参照，空字符串恢复生成来源；不改变查看或采用对象。',
      {
        pane: {
          type: 'string',
          enum: ['canvas', 'prompt', 'changes', 'images', 'suggestions', 'history'],
        },
        version_id: { type: 'string' },
        compare_version_id: { type: 'string' },
      },
      ['pane'],
      (argumentsRecord) => {
        if (
          !['canvas', 'prompt', 'changes', 'images', 'suggestions', 'history'].includes(
            String(argumentsRecord.pane),
          )
        ) {
          throw new Error('未知工作台页面')
        }
        if (
          argumentsRecord.compare_version_id !== undefined &&
          (typeof argumentsRecord.compare_version_id !== 'string' ||
            argumentsRecord.pane !== 'changes')
        ) {
          throw new Error('对比对象仅用于修改对比面板')
        }
      },
    ),
    tool(
      'ui_set_workspace_input',
      '填写讨论内容',
      'compose',
      '在可见的工作台输入框填写需求，选择区域和参考版本。只填入，不发送、不调用 AI；随后使用 ui_send_workspace_message。',
      {
        text: { type: 'string' },
        region_id: { type: ['string', 'null'] },
        reference_ids: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      },
      ['text'],
      (argumentsRecord) => {
        if (typeof argumentsRecord.text !== 'string' || argumentsRecord.text.length > 6000) {
          throw new Error('讨论内容须为不超过 6000 字的文本')
        }
        if (
          argumentsRecord.reference_ids !== undefined &&
          (!Array.isArray(argumentsRecord.reference_ids) ||
            argumentsRecord.reference_ids.length > 2 ||
            argumentsRecord.reference_ids.some((storedValue) => typeof storedValue !== 'string'))
        ) {
          throw new Error('最多引用两个版本')
        }
      },
    ),
    tool(
      'ui_send_workspace_message',
      '提交讨论',
      'send',
      '提交当前输入。内置模式调用配置的 AI；外部接管模式只保存待处理需求，不调用内置 AI，不自动唤醒外部 Agent。随后读取 get_workspace_context 并写回回复。不会自动采纳或生图。',
      {},
      [],
      undefined,
      () => null,
    ),
    tool(
      'ui_add_workspace_region',
      '绘制区域批注',
      'region',
      '打开前台选区编辑器，用原图像素矩形绘制一个新区域，显示批注后保存回工作台。保留已有区域；不调用 AI 或生成。返回状态包含新区域 id。',
      {
        rectangles: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
        },
        instruction: { type: 'string' },
        target: { type: ['integer', 'null'] },
      },
      ['rectangles', 'instruction'],
      (argumentsRecord) => {
        if (
          typeof argumentsRecord.instruction !== 'string' ||
          !argumentsRecord.instruction.trim() ||
          argumentsRecord.instruction.length > 6000
        ) {
          throw new Error('请填写有效区域批注')
        }
        if (
          !Array.isArray(argumentsRecord.rectangles) ||
          !argumentsRecord.rectangles.length ||
          argumentsRecord.rectangles.length > 32 ||
          argumentsRecord.rectangles.some(
            (record) =>
              !record ||
              !['x', 'y', 'width', 'height'].every((text) => Number.isInteger(record[text])) ||
              record.x < 0 ||
              record.y < 0 ||
              record.width <= 0 ||
              record.height <= 0,
          )
        ) {
          throw new Error('选区矩形无效')
        }
        if (
          argumentsRecord.target != null &&
          (!Number.isInteger(argumentsRecord.target) || Number(argumentsRecord.target) < 0)
        ) {
          throw new Error('角色索引无效')
        }
      },
    ),
    tool(
      'ui_review_workspace',
      '处理建议或版本',
      'review',
      '先显示对应建议及修改对比，再采纳、拒绝或撤销。decision=switch 显示历史并从指定版本继续；不生图。',
      {
        decision: { type: 'string', enum: ['accept', 'reject', 'undo', 'switch'] },
        message_id: { type: 'string' },
        version_id: { type: 'string' },
      },
      ['decision'],
      (argumentsRecord) => {
        if (!['accept', 'reject', 'undo', 'switch'].includes(String(argumentsRecord.decision))) {
          throw new Error('未知审核操作')
        }
        nonempty(
          argumentsRecord.decision === 'switch'
            ? argumentsRecord.version_id
            : argumentsRecord.message_id,
          '目标 id',
        )
      },
    ),
    tool(
      'ui_generate_workspace',
      '执行生成或重绘',
      'generate',
      '在前台选择整图生成或已有区域重绘，显示遮罩、执行方式和生成进度，结果进入工作台历史。只使用已采纳稿。必须取得用户生成授权，强制免费检查。',
      {
        kind: { type: 'string', enum: ['generate', 'inpaint'] },
        region_id: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      ['kind', 'confirm'],
      (argumentsRecord) => {
        if (argumentsRecord.confirm !== true) {
          throw new Error('必须获得用户生成授权并传 confirm:true')
        }
        if (!['generate', 'inpaint'].includes(String(argumentsRecord.kind))) {
          throw new Error('未知生成方式')
        }
        if (argumentsRecord.kind === 'inpaint') {
          nonempty(argumentsRecord.region_id, '重绘区域 id')
        }
      },
      () => {
        if (!getSettings().mcpAllowGenerate) {
          return '请先开启允许 Agent 生图' as const
        }
        if (!getSettings().naiToken) {
          return '请先配置 NovelAI Token' as const
        }
        return null
      },
    ),
  ]
}
