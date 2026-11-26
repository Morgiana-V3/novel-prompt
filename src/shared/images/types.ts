import type { Img2ImgBase, NaiGenRequest } from '../generation/types'

export interface NaiImage {
  collectionId?: string
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
  sourceKind: 'generate' | 'img2img' | 'inpaint' | 'legacy'
  /** 兼容旧 PNG 中附带的底图配置。当前图片的记录始终是 request。 */
  base?: NaiGenRequest
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
  /** 纯配置收藏的底图与参数。 */
  img2img?: Img2ImgBase
}
