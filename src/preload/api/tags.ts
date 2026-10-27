import type { DbStatus, SearchHit, SearchOptions } from '../../shared/tags/types'
import { invoke } from './bridge'

export const tagsApi = {
  dbStatus: (): Promise<DbStatus> => invoke('db:status'),
  dbUpdate: (): Promise<DbStatus> => invoke('db:update'),
  dbImplications: (): Promise<DbStatus> => invoke('db:implications'),
  search: (opts: SearchOptions): Promise<SearchHit[]> => invoke('tag:search', opts),
  setZh: (name: string, zh: string): Promise<void> => invoke('tag:setZh', name, zh),
}
