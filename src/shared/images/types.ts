import type { NaiGenRequest } from '../generation/types'

export interface NaiImage {
  /** 文件名（位于本地图库目录） */
  name: string
  /** 渲染进程可直接使用的地址 */
  url: string
  seed?: number
  width?: number
  height?: number
  createdAt: number
  storage?: 'temporary' | 'saved' | 'workspace'
  missing?: boolean
  contentHash?: string
}

export interface ImageRecipe {
  schema: 1
  request: NaiGenRequest
  createdAt: number
  /** 重绘收藏只复用提示词和设置；完整重绘依赖工作台中的底图与遮罩。 */
  sourceKind: 'generate' | 'inpaint' | 'legacy'
}

export interface SavedRecipe {
  imageUrl?: string
  contentHash?: string
  sourceImages?: string[]
  id: string
  name: string
  note: string
  tags: string[]
  createdAt: number
  sourceImage: string
  thumbnail: string
  recipe: ImageRecipe
}
