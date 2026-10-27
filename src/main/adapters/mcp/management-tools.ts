import {
  patchWorkspaceConfig,
  WORKSPACE_CONFIG_SCHEMA,
  type WorkspaceConfigPatch,
} from '../../../shared/workspace/config'
import { pageCurrent } from '../../../shared/workspace/model'
import { requireAgent } from '../../modules/workspace/agent-sessions'
import {
  clearPageImage,
  deletePageWithImages,
  deleteUnreferencedImage,
} from '../../modules/workspace/image-cleanup'
import { readPage } from '../../modules/workspace/repository'
import { editPage } from '../../modules/workspace/service'
import type { DesktopBridge } from '../desktop/bridge'
import { workspaceRectangleMask } from './inpaint-tools'
import type { McpTool } from './types'
import { workspaceReceipt } from './workspace-read'

const id = { type: 'string', minLength: 1 }
const revision = { type: 'integer', minimum: 0 }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const destructive = { ...write, destructiveHint: true }
const confirmed = (value: unknown) => {
  if (value !== true) {
    throw new Error('删除须有用户授权并传 confirm:true')
  }
}
function owned(id: string, revision: unknown) {
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('会话已变化，请重新读取后继续')
  }
  if (
    workspace.agentMode === 'external' &&
    workspace.externalAgent?.sessionId !== requireAgent().sessionId
  ) {
    throw new Error('当前 Agent 未接管此会话')
  }
  return workspace
}
export function managementTools(desktop: DesktopBridge): McpTool[] {
  return [
    {
      name: 'update_workspace',
      title: '修改项目名称或下一版配置',
      description:
        '后台修改项目名称、目标或下一版配置，不打开窗口、不生成。patch 与前台配置编辑使用相同校验；不改历史图片快照。必须使用最新 revision，版本配置还须指定已采用 version_id。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id,
          revision,
          version_id: id,
          title: { type: 'string', minLength: 1, maxLength: 100 },
          goal: { type: 'string', maxLength: 6000 },
          preserve: { type: 'string', maxLength: 6000 },
          patch: WORKSPACE_CONFIG_SCHEMA,
        },
        required: ['id', 'revision'],
      },
      annotations: write,
      run: async (argumentsRecord) =>
        desktop.withWorkspace(String(argumentsRecord.id), () => {
          let workspace = owned(String(argumentsRecord.id), argumentsRecord.revision)
          if (
            argumentsRecord.patch !== undefined &&
            (argumentsRecord.title !== undefined ||
              argumentsRecord.goal !== undefined ||
              argumentsRecord.preserve !== undefined)
          ) {
            throw new Error('配置与项目名称/目标请分别提交，避免部分保存')
          }
          if (argumentsRecord.patch !== undefined) {
            const version = pageCurrent(workspace)
            if (argumentsRecord.version_id !== version.id) {
              throw new Error('配置只能修改已采用版本，请提供其 version_id')
            }
            const editor = patchWorkspaceConfig(
              version.editor,
              argumentsRecord.patch as WorkspaceConfigPatch,
              workspace.execution.kind === 'inpaint' || !!version.editor.regions.length,
            )
            workspace = editPage(workspace.id, workspace.revision, {
              type: 'editor',
              versionId: version.id,
              editor,
            })
          } else {
            if (
              ![argumentsRecord.title, argumentsRecord.goal, argumentsRecord.preserve].some(
                (value) => value !== undefined,
              )
            ) {
              throw new Error('请提供要修改的名称、目标或配置')
            }
            if (argumentsRecord.title !== undefined && !String(argumentsRecord.title).trim()) {
              throw new Error('项目名称不能为空')
            }
            workspace = editPage(workspace.id, workspace.revision, {
              type: 'notes',
              title:
                argumentsRecord.title === undefined
                  ? workspace.title
                  : String(argumentsRecord.title).trim(),
              goal:
                argumentsRecord.goal === undefined ? workspace.goal : String(argumentsRecord.goal),
              preserve:
                argumentsRecord.preserve === undefined
                  ? workspace.preserve
                  : String(argumentsRecord.preserve),
              composer: workspace.composer,
            })
          }
          return JSON.stringify({ ...workspaceReceipt(workspace), outcome: 'updated' })
        }),
    },
    {
      name: 'delete_workspace_image',
      title: '删除项目中的指定图片',
      description:
        '删除指定候选图片及生成文件，保留提示词、参数和讨论记录。复用界面清理流程；其他项目引用的共享文件保留。需用户授权、confirm:true 和最新 revision。',
      inputSchema: {
        type: 'object',
        properties: { id, revision, version_id: id, confirm: { type: 'boolean' } },
        required: ['id', 'revision', 'version_id', 'confirm'],
      },
      annotations: destructive,
      run: async (argumentsRecord) => {
        confirmed(argumentsRecord.confirm)
        return desktop.withWorkspace(String(argumentsRecord.id), async () => {
          const workspace = owned(String(argumentsRecord.id), argumentsRecord.revision)
          const updated = await clearPageImage(
            workspace.id,
            workspace.revision,
            String(argumentsRecord.version_id),
          )
          return JSON.stringify({
            ...workspaceReceipt(updated),
            outcome: 'deleted',
            deletedVersionId: argumentsRecord.version_id,
          })
        })
      },
    },
    {
      name: 'delete_workspace',
      title: '删除项目并清理图片',
      description:
        '归档项目记录，所属图片及生成文件移入回收站；其他项目仍引用的图片保留。需用户授权、confirm:true 和最新 revision。不打开窗口。',
      inputSchema: {
        type: 'object',
        properties: { id, revision, confirm: { type: 'boolean' } },
        required: ['id', 'revision', 'confirm'],
      },
      annotations: destructive,
      run: async (argumentsRecord) => {
        confirmed(argumentsRecord.confirm)
        return desktop.withWorkspace(String(argumentsRecord.id), async () => {
          const workspace = owned(String(argumentsRecord.id), argumentsRecord.revision)
          await deletePageWithImages(workspace.id, workspace.revision)
          return JSON.stringify({
            id: workspace.id,
            outcome: 'deleted',
            records: 'archived',
            images: 'recycle-bin',
            sharedImages: 'preserved',
          })
        })
      },
    },
    {
      name: 'delete_image',
      title: '删除图库图片',
      description:
        '将没有项目引用的图库图片及其生成文件移入回收站。项目图片请用 delete_workspace_image，不能绕过引用保护。需用户授权与 confirm:true。',
      inputSchema: {
        type: 'object',
        properties: { name: id, confirm: { type: 'boolean' } },
        required: ['name', 'confirm'],
      },
      annotations: destructive,
      run: async (argumentsRecord) => {
        confirmed(argumentsRecord.confirm)
        const deleted = await deleteUnreferencedImage(String(argumentsRecord.name))
        return JSON.stringify({
          name: argumentsRecord.name,
          outcome: deleted ? 'deleted' : 'not_found',
        })
      },
    },
    {
      name: 'update_workspace_region',
      title: '修改或删除区域批注',
      description:
        '后台修改已采用候选的已有区域，保留其他区域。可更新批注、目标角色或像素矩形并集；删除须 confirm:true。修改遮罩会使该区域旧建议失效，不生成图片。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id,
          revision,
          version_id: id,
          region_id: id,
          action: { type: 'string', enum: ['update', 'delete'] },
          confirm: { type: 'boolean' },
          instruction: { type: 'string', minLength: 1, maxLength: 6000 },
          target: { type: ['integer', 'null'], minimum: 0 },
          rectangles: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            items: {
              type: 'object',
              properties: {
                x: { type: 'integer', minimum: 0 },
                y: { type: 'integer', minimum: 0 },
                width: { type: 'integer', minimum: 1 },
                height: { type: 'integer', minimum: 1 },
              },
              required: ['x', 'y', 'width', 'height'],
            },
          },
        },
        required: ['id', 'revision', 'version_id', 'region_id', 'action'],
      },
      annotations: destructive,
      run: async (argumentsRecord) =>
        desktop.withWorkspace(String(argumentsRecord.id), () => {
          const workspace = owned(String(argumentsRecord.id), argumentsRecord.revision)
          const version = pageCurrent(workspace)
          if (argumentsRecord.version_id !== version.id) {
            throw new Error('区域只能修改已采用版本')
          }
          const region = version.editor.regions.find(
            (region2) => region2.id === argumentsRecord.region_id,
          )
          if (!region) {
            throw new Error('区域不存在')
          }
          const editor = structuredClone(version.editor)
          if (argumentsRecord.action === 'delete') {
            confirmed(argumentsRecord.confirm)
            editor.regions = editor.regions.filter((region2) => region2.id !== region.id)
          } else {
            if (
              ![
                argumentsRecord.instruction,
                argumentsRecord.target,
                argumentsRecord.rectangles,
              ].some((value) => value !== undefined)
            ) {
              throw new Error('请提供要修改的区域字段')
            }
            const target = editor.regions.find((region2) => region2.id === region.id)!
            if (argumentsRecord.instruction !== undefined) {
              target.instruction = String(argumentsRecord.instruction)
            }
            if (argumentsRecord.target !== undefined) {
              target.target = argumentsRecord.target as number | null
            }
            if (argumentsRecord.rectangles !== undefined) {
              if (!version.image || version.image.missing) {
                throw new Error('当前版本没有可读取的图片')
              }
              target.mask = workspaceRectangleMask(version.image.name, argumentsRecord.rectangles)
            }
            target.accepted = null
          }
          return JSON.stringify({
            ...workspaceReceipt(
              editPage(workspace.id, workspace.revision, {
                type: 'editor',
                versionId: version.id,
                editor,
              }),
            ),
            regionId: region.id,
            outcome: argumentsRecord.action === 'delete' ? 'deleted' : 'updated',
          })
        }),
    },
  ]
}
