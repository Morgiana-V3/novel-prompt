import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../../infrastructure/paths'

export const directory = () => {
  const path = join(dataDir(), 'page-workspaces')
  mkdirSync(path, { recursive: true })
  return path
}

export function file(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('无效的工作区标识')
  }
  return join(directory(), `${id}.json`)
}

export function fileSignature(path: string) {
  const fileStats = statSync(path, { bigint: true })
  return [fileStats.dev, fileStats.ino, fileStats.size, fileStats.mtimeNs, fileStats.ctimeNs].join(
    ':',
  )
}
