import { randomUUID } from 'node:crypto'
import type { AnlasOutcome } from '../../../shared/generation/pricing'
import type { PageEventMetadata, PageExecutionEvent } from '../../../shared/workspace/events'
import type { PageDiscussion } from '../../../shared/workspace/model'
import { type PageMessage, type PageWorkspace } from '../../../shared/workspace/model'

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function pageEvent(
  workspace: PageWorkspace,
  text: string,
  versionId = workspace.currentVersionId,
  event?: PageEventMetadata,
): PageMessage {
  const message: PageMessage = {
    id: randomUUID(),
    role: 'event',
    text,
    createdAt: Date.now(),
    versionId,
    ...(event ? { event, ...(event.severity === 'error' ? { error: true } : {}) } : {}),
  }
  workspace.messages.push(message)
  return message
}

export function pageExecutionEvent(
  workspace: PageWorkspace,
  text: string,
  details: Pick<
    PageExecutionEvent,
    'kind' | 'sourceVersionId' | 'versionIds' | 'requestedCount'
  > & {
    outcome?: AnlasOutcome & { stopped?: string }
    attempted: boolean
    error?: string
  },
): PageMessage {
  const { outcome } = details
  const returnedFailure = /^第 [1-9]\d* 张失败：/.test(outcome?.stopped ?? '')
    ? outcome?.stopped
    : undefined
  const error = details.error ?? returnedFailure
  const billing: PageExecutionEvent['billing'] = {
    status: details.attempted ? 'unknown' : 'not-run',
  }
  if (Number.isFinite(outcome?.anlasDelta)) {
    billing.status = 'known'
    billing.anlasDelta = outcome!.anlasDelta
  }
  if (Number.isFinite(outcome?.usageDelta)) {
    billing.usageDelta = outcome!.usageDelta
  }
  const subscription = outcome?.subscription
  if (Number.isFinite(subscription?.anlasFixed) && Number.isFinite(subscription?.anlasPurchased)) {
    billing.remainingAnlas = subscription!.anlasFixed! + subscription!.anlasPurchased!
  }
  let status: PageExecutionEvent['status'] = 'failed'
  if (details.versionIds.length) {
    status = !error && details.versionIds.length >= details.requestedCount ? 'complete' : 'partial'
  }
  let severity: PageExecutionEvent['severity'] = 'info'
  if (error || status === 'failed') {
    severity = 'error'
  } else if (outcome?.stopped || billing.status === 'unknown' || status === 'partial') {
    severity = 'warning'
  }
  const event: PageExecutionEvent = {
    schema: 1,
    type: 'execution',
    severity,
    kind: details.kind,
    sourceVersionId: details.sourceVersionId,
    versionIds: [...details.versionIds],
    adoptedVersionId: workspace.currentVersionId,
    requestedCount: details.requestedCount,
    status,
    stopped: outcome?.stopped ?? null,
    billing,
    ...(error ? { error } : {}),
  }
  return pageEvent(workspace, text, details.versionIds.at(-1) ?? details.sourceVersionId, event)
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
