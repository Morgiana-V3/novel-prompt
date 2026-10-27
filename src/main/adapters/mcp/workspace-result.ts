import type { PageVersion } from '../../../shared/workspace/model'
import type { readPage } from '../../modules/workspace/repository'

/** Masks can be megabytes; summaries keep context bounded while retaining stable region IDs. */
export function workspaceResult(workspace: ReturnType<typeof readPage>) {
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
    ...workspace,
    messages: workspace.messages.map((message) => ({
      ...message,
      externalRequest: message.externalRequest
        ? { status: message.externalRequest.status }
        : undefined,
      skillSnapshot: message.skillSnapshot ? { digest: message.skillSnapshot.digest } : undefined,
      proposal: message.proposal
        ? { ...message.proposal, contextKey: undefined, appliedContextKey: undefined }
        : undefined,
    })),
    versions: workspace.versions.map((version) => ({
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
    })),
  }
}
