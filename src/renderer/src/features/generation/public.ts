import { shallowReadonly } from 'vue'
import {
  imageState as mutableImageState,
  generationParams as mutableGenerationParams,
} from './state'
export type { GenOnly, WorkspaceToolKind } from './state'
export const imageState = shallowReadonly(mutableImageState)
export const generationParams = shallowReadonly(mutableGenerationParams)
export {
  DEFAULT_GEN,
  referenceDraft,
  setCreationReferences,
  setGenerationBusy,
  selectReferenceImage,
  setPreviewImage,
  clearWorkspaceImage,
  takeWorkspaceTool,
  applyGenerationParams,
  loadPreferences,
  setLoadKeepSeed,
} from './state'
