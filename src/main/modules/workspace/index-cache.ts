import {
  pageContextKey,
  pageCurrent,
  type PageWorkspace,
  type PageWorkspaceSummary,
} from '../../../shared/workspace/model'
import { imagePath } from '../images/access'
import { clone, discussionIsStale, pendingExternalRequest } from './snapshot'
import { file, fileSignature } from './storage-paths'

export type PendingPageSummary = {
  id: string
  title: string
  revision: number
  requestId: string
  agent: PageWorkspace['externalAgent']
  discussionVersionId: string
  editVersionId: string | null
  stale: boolean
}

export type PageAccess = Pick<
  PageWorkspace,
  'id' | 'revision' | 'agentMode' | 'externalAgent' | 'currentVersionId' | 'execution'
>

export type PageIndexEntry = {
  signature: string
  stamp: string
  summary: PageWorkspaceSummary
  access: PageAccess
  pending: PendingPageSummary | null
  images: [string, string | null][]
}

// Derived, bounded metadata only. Files remain authoritative; no masks or history bodies are retained.
export const pageIndex = new Map<string, PageIndexEntry>()

export const readIndexes = new WeakMap<PageWorkspace, PageIndexEntry>()

export function imageSignature(name: string): string | null {
  const path = imagePath(name)
  return path ? path + ':' + fileSignature(path) : null
}

export function rememberPage(workspace: PageWorkspace, signature: string) {
  const path = file(workspace.id)
  const version = pageCurrent(workspace)
  const request = pendingExternalRequest(workspace)
  const images: [string, string | null][] = [
    ...new Set(
      workspace.versions.flatMap((version2) => (version2.image ? [version2.image.name] : [])),
    ),
  ].map((name) => [name, imageSignature(name)])
  const summary = clone({
    id: workspace.id,
    title: workspace.title,
    updatedAt: workspace.updatedAt,
    image: version.image,
    versions: workspace.versions.length,
    messages: workspace.messages.filter((message) => message.role === 'user').length,
  })
  const pending = request
    ? clone({
        id: workspace.id,
        title: workspace.title,
        revision: workspace.revision,
        requestId: request.id,
        agent: workspace.externalAgent,
        discussionVersionId: request.discussion?.versionId ?? request.versionId,
        editVersionId: request.versionId,
        stale:
          request.versionId !== version.id ||
          request.externalRequest!.contextKey !==
            pageContextKey(version, request.regionId ?? null, workspace) ||
          discussionIsStale(workspace, request.discussion),
      })
    : null
  pageIndex.delete(path)
  const access = clone({
    id: workspace.id,
    revision: workspace.revision,
    agentMode: workspace.agentMode,
    externalAgent: workspace.externalAgent,
    currentVersionId: workspace.currentVersionId,
    execution: workspace.execution,
  })
  const entry = {
    signature,
    stamp: signature + JSON.stringify(images),
    summary,
    access,
    pending,
    images,
  }
  readIndexes.set(workspace, entry)
  if (fileSignature(path) !== signature) {
    return
  }
  pageIndex.set(path, entry)
  while (pageIndex.size > 512) {
    pageIndex.delete(pageIndex.keys().next().value!)
  }
}

export function cachedPageIndex(id: string) {
  const path = file(id)
  const entry = pageIndex.get(path)
  if (!entry) {
    return undefined
  }
  try {
    if (
      fileSignature(path) === entry.signature &&
      entry.images.every(([name, signature]) => imageSignature(name) === signature)
    ) {
      return entry
    }
  } catch {
    /* Deleted/unreadable files must take the normal read/error path. */
  }
  pageIndex.delete(path)
  return undefined
}

/** Only usable for a snapshot actually read from this unchanged file and image state. */
export function pageReadStamp(id: string): string | undefined {
  return cachedPageIndex(id)?.stamp
}
