import type { PageWorkspace } from '../../../shared/workspace/model'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 8
const snapshots = new Map<string, { stamp: string; workspace: PageWorkspace; bytes: number }>()
let retainedBytes = 0
const immutableSnapshots = new WeakSet<PageWorkspace>()
export const isPageSnapshot = (workspace: PageWorkspace) => immutableSnapshots.has(workspace)

/** Freeze the complete JSON tree; cached snapshots never expose writable nested state. */
function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return
  }
  for (const child of Object.values(value)) {
    freezeTree(child)
  }
  Object.freeze(value)
}

export function forgetPageSnapshot(path: string): void {
  retainedBytes -= snapshots.get(path)?.bytes ?? 0
  snapshots.delete(path)
}

export function cachedPageSnapshot(path: string, stamp: string | undefined) {
  const cached = snapshots.get(path)
  if (!cached || !stamp || cached.stamp !== stamp) {
    forgetPageSnapshot(path)
    return undefined
  }
  snapshots.delete(path)
  snapshots.set(path, cached)
  return cached.workspace
}

export function rememberPageSnapshot(
  path: string,
  stamp: string,
  workspace: PageWorkspace,
  bytes: number,
) {
  freezeTree(workspace)
  immutableSnapshots.add(workspace)
  forgetPageSnapshot(path)
  // The byte budget measures serialized source size, not V8 heap usage.
  if (bytes <= MAX_BYTES) {
    snapshots.set(path, { stamp, workspace, bytes })
    retainedBytes += bytes
    while (snapshots.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
      forgetPageSnapshot(snapshots.keys().next().value!)
    }
  }
  return workspace
}
