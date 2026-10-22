import { reactive } from 'vue'
import type { DbStatus, Settings, TagCategory, UpdateProgress } from '@shared/types'
import type { ImportedPrompt } from './prompt-import'

export const CAT_CLASS: Record<TagCategory, string> = {
  0: 'cat-general',
  1: 'cat-artist',
  3: 'cat-copyright',
  4: 'cat-character',
  5: 'cat-meta',
  100: 'cat-nai'
}

/** 输入框里的角色提示词（字段都是字符串，便于 v-model） */
export interface CharDraft {
  prompt: string
  negative: string
  position: string
}

export const toDrafts = (list: { prompt: string; negative?: string; position?: string }[]): CharDraft[] =>
  list.map((c) => ({ prompt: c.prompt ?? '', negative: c.negative ?? '', position: c.position ?? '' }))

export const state = reactive({
  tab: 'compare' as 'compare' | 'search' | 'ai' | 'preview' | 'settings',
  prompt: '',
  negative: '',
  /** AI 优化页的角色提示词 */
  characters: [] as CharDraft[],
  /** 其他页面要送到画面推测页的整套提示词，画面推测页读取后清空 */
  previewDraft: null as ImportedPrompt | null,
  settings: null as Settings | null,
  db: null as DbStatus | null,
  progress: null as UpdateProgress | null,
  toast: ''
})

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string): void {
  state.toast = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (state.toast = ''), 1800)
}

export async function copy(text: string): Promise<void> {
  await window.api.copy(text)
  toast('已复制')
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/** 往提示词末尾追加 tag */
export function appendTag(display: string, category: TagCategory): void {
  const tag = category === 1 ? `artist:${display}` : display
  const p = state.prompt.replace(/[\s,]+$/, '')
  state.prompt = p ? `${p}, ${tag}` : tag
  toast(`已添加：${tag}`)
}

export async function refreshDb(): Promise<void> {
  state.db = await window.api.dbStatus()
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  state.settings = await window.api.saveSettings(patch)
}
