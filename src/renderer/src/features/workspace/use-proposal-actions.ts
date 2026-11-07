import type { Ref } from 'vue'
import { pageContextKey, type PageMessage, type PageVersion } from '@shared/workspace/model'
import { regionIds } from '@shared/workspace/regions'
import { cleanErr } from '../../shared/lib/format'
import type { WorkspaceActionContext, WorkspaceMutation } from './action-context'

interface ProposalOptions {
  current: Ref<PageVersion>
  isBusy: () => boolean
  mutate: WorkspaceMutation
  selectedProposalId: Ref<string | null>
  regionId: Ref<string | null>
  selectedRegionIds: Ref<string[]>
  beginConfig: (owner?: string | null) => Promise<void>
}

/** Manual and frontend Agent decisions use the same revision-checked mutation. */
export function useProposalActions(context: WorkspaceActionContext, options: ProposalOptions) {
  const { work, operation, error: errorMessage, flushNotes, frontendContext } = context
  const { current, isBusy, mutate, selectedProposalId, regionId, selectedRegionIds, beginConfig } =
    options

  function stale(message: PageMessage) {
    return (
      !!message.proposal &&
      (message.proposal.superseded ||
        message.versionId !== current.value.id ||
        message.proposal.contextKey !==
          pageContextKey(current.value, regionIds(message.proposal), work.value))
    )
  }

  async function proposal(message: PageMessage, decision: 'accept' | 'reject' | 'undo') {
    if (isBusy()) {
      return
    }
    errorMessage.value = ''
    operation.value = 'save'
    try {
      await flushNotes()
      await mutate({ type: 'proposal', messageId: message.id, decision })
      selectedProposalId.value = null
      if (message.proposal?.regionId) {
        regionId.value = message.proposal.regionId
        selectedRegionIds.value = regionIds(message.proposal)
      }
    } catch (error) {
      errorMessage.value = cleanErr(error)
    } finally {
      operation.value = ''
    }
    if (decision === 'accept' && !errorMessage.value) {
      await beginConfig(frontendContext()?.agentSession ?? null)
    }
  }

  return { stale, proposal }
}
