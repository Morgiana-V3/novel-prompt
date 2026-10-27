import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type PageWorkspaceSummary } from '../../../shared/workspace/model'
import { imageInfo } from '../images/library'
import { workspaceImageNames } from './image-references'
import type { PageAccess, PageIndexEntry, PendingPageSummary } from './index-cache'
import { cachedPageIndex, pageIndex, readIndexes } from './index-cache'
import { readPage } from './repository'
import { clone } from './snapshot'
import { directory, file, fileSignature } from './storage-paths'

export function readPageAccess(id: string): PageAccess {
  const path = file(id)
  const entry = pageIndex.get(path)
  // Ownership/execution metadata depends only on the project file, not every
  // historical image. Keep frequent connection checks independent of gallery size.
  if (entry && fileSignature(path) === entry.signature) {
    return clone(entry.access)
  }
  return clone(readIndexes.get(readPage(id))!.access)
}

export function indexedPages(): PageIndexEntry[] {
  const dir = directory()
  const names = readdirSync(dir).filter((filename) => filename.endsWith('.json'))
  const present = new Set(names.map((filename) => join(dir, filename)))
  for (const path of pageIndex.keys()) {
    if (!present.has(path)) {
      pageIndex.delete(path)
    }
  }
  const entries: PageIndexEntry[] = []
  for (const name of names) {
    try {
      const id = name.slice(0, -5)
      let entry = cachedPageIndex(id)
      if (!entry) {
        entry = readIndexes.get(readPage(id))
      }
      if (entry) {
        entries.push(entry)
      }
    } catch (error) {
      console.error('读取创作会话失败', name, String(error))
    }
  }
  return entries.sort(
    (indexEntry, indexEntry2) => indexEntry2.summary.updatedAt - indexEntry.summary.updatedAt,
  )
}

export function listPendingPageRequests(): PendingPageSummary[] {
  return indexedPages().flatMap((indexEntry) =>
    indexEntry.pending ? [clone(indexEntry.pending)] : [],
  )
}

export function listPages(): PageWorkspaceSummary[] {
  return indexedPages().map((indexEntry) => clone(indexEntry.summary))
}

export function pageUsesImage(name: string): boolean {
  if (imageInfo(name)?.storage === 'workspace') {
    return true
  }
  return workspaceImageNames().has(name)
}
