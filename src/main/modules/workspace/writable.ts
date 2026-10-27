import { pageLocks } from './locks'
import { readPage } from './repository'

export function writablePage(id: string, revision: number) {
  if (pageLocks.has(id)) {
    throw new Error('会话仍在运行')
  }
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('会话已变化，请重新读取后继续')
  }
  return workspace
}
