import type { NaiVersion } from '../generation/types'
/** Danbooru 分类：0 通用 1 画师 3 版权 4 角色 5 元数据；100 = NovelAI 专用 tag */
export type TagCategory = 0 | 1 | 3 | 4 | 5 | 100

export const CATEGORY_LABEL: Record<TagCategory, string> = {
  0: '通用',
  1: '画师',
  3: '作品',
  4: '角色',
  5: '元数据',
  100: 'NAI',
}

export interface TagInfo {
  /** danbooru 原始名（下划线） */
  name: string
  /** NAI 书写形式（空格，括号转义） */
  display: string
  category: TagCategory
  count: number
  zh?: string
  /** 仅对 NAI 专用 tag：适用版本 */
  versions?: NaiVersion[]
}

export interface SearchHit extends TagInfo {
  /** 命中的别名（如果是通过别名搜到的） */
  viaAlias?: string
  score: number
}

export interface SearchOptions {
  query: string
  categories?: TagCategory[]
  limit?: number
}

export interface DbStatus {
  loaded: boolean
  tagCount: number
  aliasCount: number
  zhCount: number
  /** 包含关系条数（0 = 尚未下载） */
  implicationCount: number
  fetchedAt?: string
  minCount?: number
  /** 当前 tag 数据来自安装包内置（default）还是用户自己下载（user） */
  source?: 'default' | 'user'
}

export interface UpdateProgress {
  stage:
    | 'tags'
    | 'aliases'
    | 'implications'
    | 'translations'
    | 'index'
    | 'done'
    | 'error'
    | 'ai-translate'
  message: string
  current?: number
  total?: number
}
