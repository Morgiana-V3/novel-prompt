import { storageRoot } from './storage-root'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function dataDir(): string {
  const dir = join(storageRoot(), 'data')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function dataFile(name: string): string {
  return join(dataDir(), name)
}
