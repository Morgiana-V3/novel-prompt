/** Shared bounds for saved settings and completion requests. */
export const DEFAULT_TAG_COMPLETION_LIMIT = 20
export const MAX_TAG_COMPLETION_LIMIT = 100

export function tagCompletionLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TAG_COMPLETION_LIMIT
  }
  return Math.max(1, Math.min(MAX_TAG_COMPLETION_LIMIT, Math.floor(value)))
}
