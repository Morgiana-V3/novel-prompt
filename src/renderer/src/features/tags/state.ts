import type { DbStatus, TagCategory, UpdateProgress } from '@shared/tags/types'
import { reactive } from 'vue'

export const CAT_CLASS: Record<TagCategory, string> = {
  0: 'cat-general',
  1: 'cat-artist',
  3: 'cat-copyright',
  4: 'cat-character',
  5: 'cat-meta',
  100: 'cat-nai',
}

export const tagState = reactive({
  db: null as DbStatus | null,

  progress: null as UpdateProgress | null,
})

export async function refreshDb(): Promise<void> {
  tagState.db = await window.api.dbStatus()
}
