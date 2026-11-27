import type { CanvasTool } from './canvas-project'
import type { PreciseReference } from './generation/references'
import type { NaiSampler, NaiVersion, UcPreset } from './generation/types'
import type { AiCharacter } from './prompts/types'

export const MAX_CANVAS_AI_REFERENCES = 6

export type CanvasAiMode = 'chat' | 'edit'
export type CanvasAiWireRole = 'img2img' | 'precise' | 'vibe' | 'source'
export type CanvasAiReferenceMode = PreciseReference['mode']
export type CanvasAiQualityMode = 'standard' | 'light'

export interface CanvasAiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CanvasAiPreciseRefSummary {
  imageName: string
  imageId?: number
  mode: CanvasAiReferenceMode
  strength: number
  fidelity?: number
}

export interface CanvasAiVibeRefSummary {
  imageName: string
  imageId?: number
  strength: number
  information: number
}

export interface CanvasAiImageSummary {
  id: number
  label: string
  kind: 'gallery' | 'favorite'
  galleryName?: string
  width?: number
  height?: number
  x: number
  y: number
  operationId?: number
}

export interface CanvasAiOperationSummary {
  id: number
  kind: CanvasTool
  x: number
  y: number
  width: number
  height: number
  sourceId: number | null
  version: NaiVersion
  base: string
  negative: string
  characters: AiCharacter[]
  params: {
    width: number
    height: number
    steps: number
    guidance: number
    sampler: NaiSampler
    seed: number | null
    count: number
    qualityTags: boolean
    qualityMode?: CanvasAiQualityMode
    ucPreset: UcPreset
  }
  strength: number
  noise: number
  scale: 1 | 1.5
  margins: { left: number; right: number; top: number; bottom: number }
  hasMask: boolean
  preciseReferences: CanvasAiPreciseRefSummary[]
  vibeReferences: CanvasAiVibeRefSummary[]
  lastRunMessage?: string
}

export interface CanvasAiSnapshot {
  title: string
  images: CanvasAiImageSummary[]
  operations: CanvasAiOperationSummary[]
}

export interface CanvasAiCreateOperation {
  tempId?: string
  kind: Exclude<CanvasTool, 'img2img'>
  sourceImageId?: number
  afterTempId?: string
  base?: string
  negative?: string
  characters?: AiCharacter[]
  version?: NaiVersion
  width?: number
  height?: number
  steps?: number
  guidance?: number
  sampler?: NaiSampler
  seed?: number | null
  count?: number
  qualityTags?: boolean
  qualityMode?: CanvasAiQualityMode
  ucPreset?: UcPreset
  strength?: number
  noise?: number
  scale?: 1 | 1.5
  margins?: Partial<{ left: number; right: number; top: number; bottom: number }>
  preciseReferences?: {
    imageId: number
    mode?: CanvasAiReferenceMode
    strength?: number
    fidelity?: number
  }[]
  vibeReferences?: {
    imageId: number
    strength?: number
    information?: number
  }[]
}

export interface CanvasAiUpdateOperation {
  id: number
  kind?: Exclude<CanvasTool, 'img2img'>
  sourceImageId?: number | null
  base?: string
  negative?: string
  characters?: AiCharacter[]
  version?: NaiVersion
  width?: number
  height?: number
  steps?: number
  guidance?: number
  sampler?: NaiSampler
  seed?: number | null
  count?: number
  qualityTags?: boolean
  qualityMode?: CanvasAiQualityMode
  ucPreset?: UcPreset
  strength?: number
  noise?: number
  scale?: 1 | 1.5
  margins?: Partial<{ left: number; right: number; top: number; bottom: number }>
}

export interface CanvasAiConnectWire {
  imageId: number
  operationId?: number
  operationTempId?: string
  role: CanvasAiWireRole
  strength?: number
  noise?: number
  mode?: CanvasAiReferenceMode
  fidelity?: number
  information?: number
}

export interface CanvasAiDisconnectWire {
  imageId: number
  operationId: number
  role: CanvasAiWireRole
}

export interface CanvasAiEdit {
  createOperations?: CanvasAiCreateOperation[]
  updateOperations?: CanvasAiUpdateOperation[]
  connectWires?: CanvasAiConnectWire[]
  disconnectWires?: CanvasAiDisconnectWire[]
  removeOperationIds?: number[]
}

export interface CanvasAiRequest {
  mode: CanvasAiMode
  messages: CanvasAiMessage[]
  referencedIds: number[]
  /** 本轮显式指定的 Skill，按优先级排列，最多 6 个。 */
  skillIds?: string[]
  canvas: CanvasAiSnapshot
}

export interface CanvasAiResult {
  message: string
  edit?: CanvasAiEdit
}
