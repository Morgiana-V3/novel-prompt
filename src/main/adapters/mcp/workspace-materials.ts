import type { NaiImage } from '../../../shared/images/types'
import type { PageInputContext } from '../../../shared/workspace/context'
import { pageCurrent, type PageMessage, type PageWorkspace } from '../../../shared/workspace/model'
import { buildPageInputContext } from '../../modules/workspace/input-context'
import { discussionSnapshot } from '../../modules/workspace/snapshot'
import type { contextSkills } from './skills-cache'
import { inputContextSummary } from './workspace-result'

type RegionPreview = {
  id: string
  label: string
  preview: { preview_path?: string } | null
}

/** References for the client to read; availability never certifies delivery to a model. */
export function workspaceContextMaterials(
  workspace: PageWorkspace,
  request: PageMessage | undefined,
  previews: RegionPreview[],
  skills: ReturnType<typeof contextSkills>,
) {
  let inputContext: PageInputContext | null = request?.inputContext ?? null
  let inputContextSource = inputContext ? 'frozen' : 'none'
  let reconstructionNote: string | null = null
  if (request && !inputContext) {
    inputContextSource = 'unavailable'
    reconstructionNote = '旧需求未保存完整输入快照，不能证明发送时的全部输入。'
    if (request.skillSnapshot) {
      try {
        inputContext = buildPageInputContext(workspace, request, request.skillSnapshot)
        inputContextSource = 'reconstructed'
        reconstructionNote += '当前返回内容按现存状态重建，不是原时刻的冻结输入。'
      } catch {
        reconstructionNote += '所引用版本或区域现已变化，无法安全重建；请核对当前请求与历史。'
      }
    }
  }
  const current = pageCurrent(workspace)
  const discussion =
    inputContext?.discussion ?? request?.discussion ?? discussionSnapshot(workspace)
  const imageRead = (image: NaiImage | null) => {
    let availability = 'none'
    if (image) {
      availability = image.missing ? 'missing' : 'available'
    }
    return {
      name: image?.name ?? null,
      contentHash: image?.contentHash ?? null,
      availability,
      read:
        image && !image.missing ? { tool: 'read_image', arguments: { name: image.name } } : null,
    }
  }
  const decisions = inputContext?.history.decisions ?? []
  const missingRuleIds = skills?.missingRequiredIds ?? []
  return {
    inputContext: inputContext
      ? {
          ...inputContextSummary(inputContext),
          detailAvailable: inputContextSource === 'frozen',
          read:
            inputContextSource === 'frozen'
              ? {
                  tool: 'get_workspace',
                  arguments: {
                    id: workspace.id,
                    detail: 'full',
                    message_ids: [inputContext.requestId],
                  },
                }
              : null,
        }
      : null,
    materials: {
      kind: 'read-checklist',
      inputContextSource,
      reconstructionNote,
      deliveryNote:
        '清单和路径表示可读取材料，不表示图片或规则正文已进入模型上下文、已理解或已验收。',
      request: request
        ? {
            id: request.id,
            revision: workspace.revision,
            inputRevision: inputContext?.revision ?? null,
          }
        : null,
      discussion: { versionId: discussion.versionId, ...imageRead(discussion.image) },
      editTarget: { versionId: current.id, ...imageRead(current.image) },
      references: (inputContext?.references ?? []).map((reference) => ({
        versionId: reference.versionId,
        ...imageRead(reference.image),
      })),
      regionPreviews: previews.map((region) => ({
        id: region.id,
        label: region.label,
        previewPath: region.preview?.preview_path ?? null,
        read: region.preview?.preview_path
          ? { tool: 'read_image', arguments: { preview_path: region.preview.preview_path } }
          : null,
      })),
      rules: {
        digest: skills?.digest ?? null,
        missingRequiredIds: missingRuleIds,
        retentionSource: skills?.retentionSource ?? null,
        read: missingRuleIds.length
          ? {
              tool: 'get_workspace_context',
              arguments: {
                id: workspace.id,
                rules_only: true,
                skills_task: skills!.task,
                skills_ids: missingRuleIds,
              },
            }
          : null,
      },
      decisions,
      historyRead: decisions.length
        ? {
            tool: 'get_workspace',
            arguments: {
              id: workspace.id,
              detail: 'full',
              message_ids: decisions.map((decision) => decision.messageId),
            },
          }
        : null,
    },
  }
}
