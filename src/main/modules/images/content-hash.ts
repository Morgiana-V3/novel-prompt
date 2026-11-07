import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const hashes = new Map<string, { signature: string; hash: string }>()
const signature = (path: string) => {
  const stats = statSync(path, { bigint: true })
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
}

/** Replacements invalidate persisted hashes too; never retain image bytes in this cache. */
export function imageContentHash(path: string): string {
  const stamp = signature(path)
  const cached = hashes.get(path)
  if (cached?.signature === stamp) {
    return cached.hash
  }
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (signature(path) !== stamp) {
    throw new Error('图片在读取时已改变，请重新读取当前状态')
  }
  hashes.delete(path)
  hashes.set(path, { signature: stamp, hash })
  while (hashes.size > 256) {
    hashes.delete(hashes.keys().next().value!)
  }
  return hash
}
