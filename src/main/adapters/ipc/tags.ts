import type { SearchOptions, TagCategory } from '../../../shared/tags/types'
import { analyzePrompt } from '../../modules/prompts/analyzer'
import { getSettings } from '../../modules/settings/service'
import { tagStore } from '../../modules/tags/store'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerTagsIpc(_context: IpcContext): void {
  handle('db:status', () => {
    return tagStore.status()
  })

  handle('tag:search', (_e, opts: SearchOptions) => {
    return tagStore.search(opts)
  })

  handle('tag:complete', (_e, query: string, limit?: number, category?: TagCategory) => {
    return tagStore.complete(
      String(query ?? '').slice(0, 80),
      Math.min(Number(limit) || 8, 20),
      category,
    )
  })

  handle('tag:setZh', (_e, name: string, zh: string) => {
    return tagStore.setTranslation(name, zh)
  })

  handle('prompt:analyze', (_e, text: string) => {
    return analyzePrompt(text, getSettings().naiVersion)
  })
}
