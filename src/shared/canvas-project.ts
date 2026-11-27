import type { NaiGenRequest } from './generation/types'

export const CANVAS_TOOLS = {
  generate: '文生图',
  img2img: '图生图',
  inpaint: '局部重绘',
  outpaint: '扩图',
  enhance: '增强',
  upscale: '放大 2×',
} as const

export type CanvasTool = keyof typeof CANVAS_TOOLS
export interface CanvasStroke {
  radius: number
  points: CanvasPoint[]
}
export interface CanvasBox extends CanvasPoint, CanvasSize {
  id: number
}
export type CanvasOutputMode = 'inline' | 'branch'

export interface CanvasOperationOutput {
  id: string
  asset: CanvasGalleryAsset
  label: string
  workspaceId?: string
  versionId?: string
  createdAt: number
}

export interface CanvasOperation extends CanvasBox {
  kind: CanvasTool
  sourceId: number | null
  saveToGallery?: boolean
  outputMode?: CanvasOutputMode
  outputs?: CanvasOperationOutput[]
  activeOutputId?: string
  lastRun?: { workspaceId: string; message: string }
  request: NaiGenRequest
  strength: number
  noise: number
  scale: 1 | 1.5
  margins: { left: number; right: number; top: number; bottom: number }
  strokes: CanvasStroke[]
}
export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasGalleryAsset {
  kind: 'gallery'
  name: string
  label?: string
  modifiedAt?: number
  width?: number
  height?: number
}

export interface CanvasFavoriteAsset {
  kind: 'favorite'
  favoriteId: string
  label: string
  width?: number
  height?: number
}

export type CanvasAsset = CanvasGalleryAsset | CanvasFavoriteAsset

export interface CanvasImage extends CanvasPoint, CanvasSize {
  id: number
  asset: CanvasAsset
  operationId?: number
  workspaceId?: string
  versionId?: string
}

export interface CanvasCamera extends CanvasPoint {
  zoom: number
}

export interface CanvasSession {
  operations: CanvasOperation[]
  images: CanvasImage[]
  selectedId: number | null
  camera: CanvasCamera
  nextImageId: number
}

export function createCanvasSession(): CanvasSession {
  return {
    operations: [],
    images: [],
    selectedId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    nextImageId: 1,
  }
}
