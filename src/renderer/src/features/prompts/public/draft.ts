import { shallowReadonly } from 'vue'
import { promptState as state, DEFAULT_PARAMS, toDrafts } from '../state'
import type { FieldRef, WorkParams } from '../state'

// A view of the existing draft; tab switching and editing keep the same state owner.
export const promptState = shallowReadonly(state)
export { DEFAULT_PARAMS, toDrafts }
export type { CharDraft, FieldRef, Snapshot, WorkParams } from '../state'

export function setPromptFocus(field: FieldRef): void {
  state.focus = field
}

export function updatePromptParams(patch: Partial<WorkParams>): void {
  Object.assign(state.params, patch)
}

/** Restore a tab into the existing editor, preserving parameter references held by controls. */
export function restorePromptSession(snapshot: typeof state): void {
  state.prompt = snapshot.prompt
  state.negative = snapshot.negative
  state.characters = toDrafts(snapshot.characters)
  updatePromptParams({ ...DEFAULT_PARAMS, ...snapshot.params })
  state.history = snapshot.history
  state.lastPreview = snapshot.lastPreview
  state.focus = snapshot.focus
}
