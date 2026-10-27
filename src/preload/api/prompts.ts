import type {
  AiInpaintRequest,
  AiInpaintResult,
  AiOptimizeRequest,
  AiOptimizeResult,
  AiPreviewRequest,
  AiPreviewResult,
  AnalysisResult,
} from '../../shared/prompts/types'
import type { DbStatus } from '../../shared/tags/types'
import { invoke } from './bridge'

export const promptsApi = {
  aiTranslate: (): Promise<DbStatus> => invoke('db:aiTranslate'),
  analyze: (text: string): Promise<AnalysisResult> => invoke('prompt:analyze', text),
  planInpaint: (req: AiInpaintRequest): Promise<AiInpaintResult> => invoke('ai:inpaint-plan', req),
  optimize: (req: AiOptimizeRequest): Promise<AiOptimizeResult> => invoke('ai:optimize', req),
  preview: (req: AiPreviewRequest): Promise<AiPreviewResult> => invoke('ai:preview', req),
}
