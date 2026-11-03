import type { DbStatus, SearchHit, SearchOptions, TagCategory } from '../../shared/tags/types'
import { invoke } from './bridge'

export const tagsApi = {
  dbStatus: (): Promise<DbStatus> => invoke('db:status'),
  dbUpdate: (): Promise<DbStatus> => invoke('db:update'),
  dbImplications: (): Promise<DbStatus> => invoke('db:implications'),
  search: (opts: SearchOptions): Promise<SearchHit[]> => invoke('tag:search', opts),
  tagComplete: (query: string, limit?: number, category?: TagCategory): Promise<SearchHit[]> =>
    invoke('tag:complete', query, limit, category),
  setZh: (name: string, zh: string): Promise<void> => invoke('tag:setZh', name, zh),
}
