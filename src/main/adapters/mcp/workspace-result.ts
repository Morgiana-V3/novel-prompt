import type { PageMessage, PageVersion } from '../../../shared/workspace/model'
import type { PageInputContext } from '../../../shared/workspace/context'
import { latestPageExecution } from '../../../shared/workspace/events'
import type { readPage } from '../../modules/workspace/repository'

/** Masks can be megabytes; summaries keep context bounded while retaining stable region IDs. */
export function workspaceVersionResult(version: PageVersion) {
  const summarizeGeneration = (version: PageVersion) => {
    if (version.generated) {
      return {
        ...version.generated,
        inpaint: version.generated.inpaint
          ? { ...version.generated.inpaint, mask: undefined }
          : undefined,
      }
    }
    return undefined
  }
  return {
    ...version,
    generated: summarizeGeneration(version),
    editor: {
      ...version.editor,
      regions: version.editor.regions.map((region) => ({
        ...region,
        mask: undefined,
        hasMask: !!region.mask,
      })),
    },
  }
}

export function workspaceMessageResult(message: PageMessage) {
  return {
    ...message,
    inputContext: message.inputContext,
    externalRequest: message.externalRequest
      ? { status: message.externalRequest.status }
      : undefined,
    skillSnapshot: message.skillSnapshot ? { digest: message.skillSnapshot.digest } : undefined,
    proposal: message.proposal
      ? { ...message.proposal, contextKey: undefined, appliedContextKey: undefined }
      : undefined,
  }
}

/** Message lists expose only provenance/counts; full reads retain the exact frozen draft. */
export function inputContextSummary(context: PageInputContext | undefined) {
  if (!context) {
    return undefined
  }
  return {
    schema: context.schema,
    requestId: context.requestId,
    revision: context.revision,
    capturedAt: context.capturedAt,
    discussionVersionId: context.discussion.versionId,
    editTargetVersionId: context.editTarget.versionId,
    selectedRegionIds: context.selectedRegions.map((region) => region.id),
    rules: {
      digest: context.rules.digest,
      characters: context.rules.characters,
      entries: context.rules.entries.length,
    },
    history: {
      recent: context.history.recentIds.length,
      earlier: context.history.earlierIds.length,
      omitted: context.history.omittedCount,
      filteredRoutine: context.history.filteredRoutineCount ?? null,
      decisions: context.history.decisions.length,
    },
    images: { mode: context.images.mode, entries: context.images.entries.length },
    detailAvailable: true,
  }
}

export function workspaceResult(workspace: ReturnType<typeof readPage>) {
  return {
    ...workspace,
    latestExecution: latestPageExecution(workspace.messages),
    messages: workspace.messages.map(workspaceMessageResult),
    versions: workspace.versions.map(workspaceVersionResult),
  }
}
