import { randomUUID } from 'node:crypto'
import type { PageDiscussion } from '../../../shared/workspace/model'
import { type PageMessage, type PageWorkspace } from '../../../shared/workspace/model'

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function pageEvent(
  workspace: PageWorkspace,
  text: string,
  versionId = workspace.currentVersionId,
): void {
  workspace.messages.push({
    id: randomUUID(),
    role: 'event',
    text,
    createdAt: Date.now(),
    versionId,
  })
}

export function pageMessage(
  role: PageMessage['role'],
  text: string,
  versionId: string,
): PageMessage {
  return { id: randomUUID(), role, text, versionId, createdAt: Date.now() }
}

export function pendingExternalRequest(workspace: PageWorkspace) {
  return workspace.messages.find((message) => message.externalRequest?.status === 'pending')
}

export function discussionSnapshot(
  workspace: PageWorkspace,
  versionId = workspace.currentVersionId,
): PageDiscussion {
  const version = workspace.versions.find((version2) => version2.id === versionId)
  if (!version) {
    throw new Error('讨论版本已不存在，请重新选择')
  }
  const recipe = version.generated ?? version.initial
  const resolveRecipe = (): PageDiscussion['recipe'] => {
    if (recipe) {
      return {
        source: version.generated ? 'generated' : 'initial',
        draft: recipe.draft,
        params: recipe.params,
      }
    }
    return null
  }
  return clone({
    versionId: version.id,
    label: version.label,
    image: version.image,
    recipe: resolveRecipe(),
  })
}

export function discussionIsStale(workspace: PageWorkspace, discussion?: PageDiscussion): boolean {
  if (!discussion) {
    return false
  } // Requests saved before discussion snapshots used the adopted version.
  if (!workspace.versions.some((version) => version.id === discussion.versionId)) {
    return true
  }
  const key = (discussion2: PageDiscussion) =>
    JSON.stringify([
      discussion2.versionId,
      discussion2.image?.name,
      discussion2.image?.contentHash,
      !!discussion2.image?.missing,
      discussion2.recipe,
    ])
  return key(discussion) !== key(discussionSnapshot(workspace, discussion.versionId))
}
