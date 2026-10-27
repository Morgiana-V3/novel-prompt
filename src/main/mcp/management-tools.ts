import type { DesktopBridge } from '../desktop'
import type { McpTool } from './server'
import { requireAgent } from '../agent-sessions'
import { readPage, editPage } from '../page-workspaces'
import { clearPageImage, deletePageWithImages, deleteUnreferencedImage } from '../workspace-cleanup'
import { pageCurrent } from '../../shared/page-workspace'
import { patchWorkspaceConfig, WORKSPACE_CONFIG_SCHEMA, type WorkspaceConfigPatch } from '../../shared/workspace-config'
import { workspaceReceipt } from './workspace-read'
import { workspaceRectangleMask } from './inpaint-tools'

const id = { type: 'string', minLength: 1 }
const revision = { type: 'integer', minimum: 0 }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const destructive = { ...write, destructiveHint: true }
const confirmed = (value: unknown) => { if (value !== true) throw new Error('删除须有用户授权并传 confirm:true') }
function owned(id: string, revision: unknown) {
  const w = readPage(id)
  if (w.revision !== revision) throw new Error('会话已变化，请重新读取后继续')
  if (w.agentMode === 'external' && w.externalAgent?.sessionId !== requireAgent().sessionId) throw new Error('当前 Agent 未接管此会话')
  return w
}
export function managementTools(desktop: DesktopBridge): McpTool[] {
  return [
    { name: 'update_workspace', title: '修改项目名称或下一版配置',
      description: '后台修改项目名称、目标或下一版配置，不打开窗口、不生成。patch 与前台配置编辑使用相同校验；不改历史图片快照。必须使用最新 revision，版本配置还须指定已采用 version_id。',
      inputSchema: { type: 'object', additionalProperties: false, properties: { id, revision, version_id: id, title: { type: 'string', minLength: 1, maxLength: 100 }, goal: { type: 'string', maxLength: 6000 }, preserve: { type: 'string', maxLength: 6000 }, patch: WORKSPACE_CONFIG_SCHEMA }, required: ['id', 'revision'] }, annotations: write,
      run: async a => desktop.withWorkspace(String(a.id), () => {
        let w = owned(String(a.id), a.revision)
        if (a.patch !== undefined && (a.title !== undefined || a.goal !== undefined || a.preserve !== undefined)) throw new Error('配置与项目名称/目标请分别提交，避免部分保存')
        if (a.patch !== undefined) {
          const v = pageCurrent(w)
          if (a.version_id !== v.id) throw new Error('配置只能修改已采用版本，请提供其 version_id')
          const editor = patchWorkspaceConfig(v.editor, a.patch as WorkspaceConfigPatch, w.execution.kind === 'inpaint' || !!v.editor.regions.length)
          w = editPage(w.id, w.revision, { type: 'editor', versionId: v.id, editor })
        } else {
          if (![a.title, a.goal, a.preserve].some(v => v !== undefined)) throw new Error('请提供要修改的名称、目标或配置')
          if (a.title !== undefined && !String(a.title).trim()) throw new Error('项目名称不能为空')
          w = editPage(w.id, w.revision, { type: 'notes', title: a.title === undefined ? w.title : String(a.title).trim(), goal: a.goal === undefined ? w.goal : String(a.goal), preserve: a.preserve === undefined ? w.preserve : String(a.preserve), composer: w.composer })
        }
        return JSON.stringify({ ...workspaceReceipt(w), outcome: 'updated' })
      }) },
    { name: 'delete_workspace_image', title: '删除项目中的指定图片', description: '删除指定候选图片及生成文件，保留提示词、参数和讨论记录。复用界面清理流程；其他项目引用的共享文件保留。需用户授权、confirm:true 和最新 revision。',
      inputSchema: { type: 'object', properties: { id, revision, version_id: id, confirm: { type: 'boolean' } }, required: ['id', 'revision', 'version_id', 'confirm'] }, annotations: destructive,
      run: async a => { confirmed(a.confirm); return desktop.withWorkspace(String(a.id), async () => {
        const w = owned(String(a.id), a.revision)
        const updated = await clearPageImage(w.id, w.revision, String(a.version_id))
        return JSON.stringify({ ...workspaceReceipt(updated), outcome: 'deleted', deletedVersionId: a.version_id })
      }) } },
    { name: 'delete_workspace', title: '删除项目并清理图片', description: '归档项目记录，所属图片及生成文件移入回收站；其他项目仍引用的图片保留。需用户授权、confirm:true 和最新 revision。不打开窗口。',
      inputSchema: { type: 'object', properties: { id, revision, confirm: { type: 'boolean' } }, required: ['id', 'revision', 'confirm'] }, annotations: destructive,
      run: async a => { confirmed(a.confirm); return desktop.withWorkspace(String(a.id), async () => {
        const w = owned(String(a.id), a.revision)
        await deletePageWithImages(w.id, w.revision)
        return JSON.stringify({ id: w.id, outcome: 'deleted', records: 'archived', images: 'recycle-bin', sharedImages: 'preserved' })
      }) } },
    { name: 'delete_image', title: '删除图库图片', description: '将没有项目引用的图库图片及其生成文件移入回收站。项目图片请用 delete_workspace_image，不能绕过引用保护。需用户授权与 confirm:true。',
      inputSchema: { type: 'object', properties: { name: id, confirm: { type: 'boolean' } }, required: ['name', 'confirm'] }, annotations: destructive,
      run: async a => { confirmed(a.confirm); const deleted = await deleteUnreferencedImage(String(a.name)); return JSON.stringify({ name: a.name, outcome: deleted ? 'deleted' : 'not_found' }) } },
    { name: 'update_workspace_region', title: '修改或删除区域批注', description: '后台修改已采用候选的已有区域，保留其他区域。可更新批注、目标角色或像素矩形并集；删除须 confirm:true。修改遮罩会使该区域旧建议失效，不生成图片。',
      inputSchema: { type: 'object', additionalProperties: false, properties: { id, revision, version_id: id, region_id: id, action: { type: 'string', enum: ['update', 'delete'] }, confirm: { type: 'boolean' }, instruction: { type: 'string', minLength: 1, maxLength: 6000 }, target: { type: ['integer', 'null'], minimum: 0 }, rectangles: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } }, required: ['x', 'y', 'width', 'height'] } } }, required: ['id', 'revision', 'version_id', 'region_id', 'action'] }, annotations: destructive,
      run: async a => desktop.withWorkspace(String(a.id), () => {
        const w = owned(String(a.id), a.revision), v = pageCurrent(w)
        if (a.version_id !== v.id) throw new Error('区域只能修改已采用版本')
        const region = v.editor.regions.find(r => r.id === a.region_id)
        if (!region) throw new Error('区域不存在')
        const editor = structuredClone(v.editor)
        if (a.action === 'delete') { confirmed(a.confirm); editor.regions = editor.regions.filter(r => r.id !== region.id) }
        else {
          if (![a.instruction, a.target, a.rectangles].some(v => v !== undefined)) throw new Error('请提供要修改的区域字段')
          const target = editor.regions.find(r => r.id === region.id)!
          if (a.instruction !== undefined) target.instruction = String(a.instruction)
          if (a.target !== undefined) target.target = a.target as number | null
          if (a.rectangles !== undefined) {
            if (!v.image || v.image.missing) throw new Error('当前版本没有可读取的图片')
            target.mask = workspaceRectangleMask(v.image.name, a.rectangles)
          }
          target.accepted = null
        }
        return JSON.stringify({ ...workspaceReceipt(editPage(w.id, w.revision, { type: 'editor', versionId: v.id, editor })), regionId: region.id, outcome: a.action === 'delete' ? 'deleted' : 'updated' })
      }) }
  ]
}
