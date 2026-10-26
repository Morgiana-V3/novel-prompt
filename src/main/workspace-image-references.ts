import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

const cache = new Map<string, { stamp: string; names: string[] }>()
/** Read references without migrating, moving or rewriting any legacy workspace. */
export function workspaceImageNames(): Set<string> {
  const root = join(dataDir(), 'page-workspaces'), names = new Set<string>(), seen = new Set<string>()
  for (const dir of [root, join(root, 'removed')]) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(dir, entry.name); seen.add(path)
      try {
        const stat = statSync(path), stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
        if (cache.get(path)?.stamp !== stamp) {
          const w = JSON.parse(readFileSync(path, 'utf8'))
          if (!Array.isArray(w.versions)) throw new Error('Missing versions')
          cache.set(path, { stamp, names: w.versions.flatMap((v: { image?: { name?: unknown } }) => typeof v.image?.name === 'string' ? [v.image.name] : []) })
        }
      } catch { /* Keep previously known references if a document becomes unreadable. */ }
      cache.get(path)?.names.forEach(name => names.add(name))
    }
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return names
}
