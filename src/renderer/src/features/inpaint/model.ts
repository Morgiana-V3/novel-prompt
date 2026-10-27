import type { InpaintDraft, InpaintPlan } from '@shared/prompts/types'
export type Point = { x: number; y: number }
export type Stroke = { tool: 'brush' | 'erase' | 'rect'; radius: number; points: Point[] }
export type Region = {
  id: string
  label: string
  number: number
  annotated: boolean
  anchor: Point | null
  baseMask: HTMLCanvasElement | null
  instruction: string
  target: number | null
  strokes: Stroke[]
  hasPixels: boolean
  plan: InpaintPlan | null
  checked: boolean[]
  accepted: InpaintDraft | null
}
export type RegionBackup = Pick<
  Region,
  | 'annotated'
  | 'anchor'
  | 'baseMask'
  | 'instruction'
  | 'target'
  | 'strokes'
  | 'hasPixels'
  | 'plan'
  | 'checked'
  | 'accepted'
  | 'number'
>
