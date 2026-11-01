import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StorageLocation {
  path?: string
  pending?: { source: string; target: string; id: string }
  previous?: string
  error?: string
}
export const storageLocationFile = () => join(app.getPath('userData'), 'storage-location.json')
export function readStorageLocation(): StorageLocation {
  if (!existsSync(storageLocationFile())) {
    return {}
  }
  return JSON.parse(readFileSync(storageLocationFile(), 'utf8'))
}
export function storageRoot(): string {
  const location = readStorageLocation()
  if (location.path && !existsSync(location.path)) {
    throw new Error(`数据目录不可用，请连接磁盘后重试：${location.path}`)
  }
  return location.path || app.getPath('userData')
}
