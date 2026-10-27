import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

const cache = new Map<string, { stamp: string; names: string[] }>()
/** Read references without migrating, moving or rewriting any legacy workspace. */
export function workspaceImageNames(options: { includeRemoved?: boolean; excludeId?: string; strict?: boolean } = {}): Set<string> {
  const root = join(dataDir(), 'page-workspaces'), names = new Set<string>(), seen = new Set<string>()
  for (const dir of options.includeRemoved === false ? [root] : [root, join(root, 'removed')]) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(dir, entry.name); seen.add(path)
      if (entry.name === `${options.excludeId}.json`) continue
      try {
        const stat = statSync(path), stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
        if (cache.get(path)?.stamp !== stamp) {
          const w = JSON.parse(readFileSync(path, 'utf8'))
          if (!Array.isArray(w.versions)) throw new Error('Missing versions')
          const images = [...w.versions, ...(w.messages ?? []).map((m: { discussion?: unknown }) => m.discussion)]
          cache.set(path, { stamp, names: images.flatMap((v: { image?: { name?: unknown } } | undefined) => typeof v?.image?.name === 'string' ? [v.image.name] : []) })
        }
      } catch { if (options.strict) throw new Error('有项目记录无法读取，暂不能安全清理图片'); /* Keep previously known references if a document becomes unreadable. */ }
      cache.get(path)?.names.forEach(name => names.add(name))
    }
  }
  if (options.includeRemoved !== false && !options.excludeId) for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return names
}
