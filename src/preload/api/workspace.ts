import type { NaiGenParams, NaiVersion } from '../../shared/generation/types'
import type { InpaintDraft } from '../../shared/prompts/types'
import type {
  PageAction,
  PageAgentIdentity,
  PageExecution,
  PageExternalReply,
  PageWorkspace,
  PageWorkspaceSummary,
} from '../../shared/workspace/model'
import { invoke } from './bridge'

export const workspaceApi = {
  pagesList: (): Promise<PageWorkspaceSummary[]> => invoke('pages:list'),
  pagesRemoved: (): Promise<{ token: string; title: string; removedAt: number }[]> =>
    invoke('pages:removed'),
  pagesRestore: (token: string): Promise<PageWorkspace> => invoke('pages:restore', token),
  pagesRecoverImage: (
    id: string,
    revision: number,
    versionId: string,
  ): Promise<PageWorkspace | null> => invoke('pages:recover-image', id, revision, versionId),
  agentConnections: (): Promise<PageAgentIdentity[]> => invoke('agents:list'),
  pagesAgent: (
    id: string,
    revision: number,
    mode: 'internal' | 'external',
    actionId?: string,
  ): Promise<PageWorkspace> => invoke('pages:agent', id, revision, mode, actionId),
  pagesExternalReply: (
    id: string,
    revision: number,
    response: PageExternalReply,
    actionId: string,
  ): Promise<PageWorkspace> => invoke('pages:external-reply', id, revision, response, actionId),
  pagesExternalCancel: (id: string, revision: number, actionId?: string): Promise<PageWorkspace> =>
    invoke('pages:external-cancel', id, revision, actionId),
  pagesImport: (
    params: NaiGenParams,
    model: NaiVersion,
    draft: InpaintDraft,
  ): Promise<PageWorkspace | null> => invoke('pages:import', params, model, draft),
  pagesDelete: (id: string, revision: number): Promise<void> =>
    invoke('pages:delete', id, revision),
  pagesClearImage: (id: string, revision: number, versionId: string): Promise<PageWorkspace> =>
    invoke('pages:clear-image', id, revision, versionId),
  pagesCleanupRemovedImages: (): Promise<number> => invoke('pages:cleanup-removed-images'),
  pagesRead: (id: string): Promise<PageWorkspace> => invoke('pages:read', id),
  pagesCreate: (
    image: string | null,
    params: NaiGenParams,
    model: NaiVersion,
    draft: InpaintDraft,
  ): Promise<PageWorkspace> => invoke('pages:create', image, params, model, draft),
  pagesEdit: (id: string, revision: number, action: PageAction): Promise<PageWorkspace> =>
    invoke('pages:edit', id, revision, action),
  pagesChat: (
    id: string,
    revision: number,
    text: string,
    region: string | null,
    refs: string[],
    actionId?: string,
    discussionVersionId?: string,
  ): Promise<PageWorkspace> =>
    invoke('pages:chat', id, revision, text, region, refs, actionId, discussionVersionId),
  pagesCancel: (id: string): Promise<void> => invoke('pages:cancel', id),
  pagesGenerate: (
    id: string,
    revision: number,
    execution: PageExecution,
    actionId?: string,
  ): Promise<PageWorkspace> => invoke('pages:generate', id, revision, execution, actionId),
}
