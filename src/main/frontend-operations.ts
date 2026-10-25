import { randomUUID } from 'node:crypto'
import type { FrontendAction } from '../shared/desktop'
import type { McpProgress } from './mcp/server'
import { currentAgent } from './agent-sessions'

// One foreground operation owns the visible workflow. Tickets only authorize the
// matching renderer request; background tools never gain this capability.
interface Operation { id: string; action: FrontendAction; workspace?: string; label: string; ctrl: AbortController; claimed: boolean; report: McpProgress; agent: ReturnType<typeof currentAgent> }
let active: Operation | null = null
export function frontendActive() { return !!active }
export function cancelFrontend() { active?.ctrl.abort() }
export function claimFrontend(id: string | undefined, action: FrontendAction, workspace: string) {
  if (id === undefined) return null
  if (!active || active.id !== id || active.action !== action || active.workspace !== workspace || active.claimed || active.ctrl.signal.aborted)
    throw new Error('前台操作已失效，请读取最新状态后重试')
  active.claimed = true
  return { signal: active.ctrl.signal, report: active.report, label: active.label, agent: active.agent }
}
export async function runFrontend<T>(action: FrontendAction, workspace: string | undefined, label: string, signal: AbortSignal,
  report: McpProgress, run: (id: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  if (active) throw new Error('另一个前台操作仍在执行，请等待完成或停止')
  if (signal.aborted) throw new Error('已取消')
  const op: Operation = { id: randomUUID(), action, workspace, label, ctrl: new AbortController(), claimed: false, report, agent: currentAgent() }
  active = op
  const cancel = () => op.ctrl.abort()
  signal.addEventListener('abort', cancel, { once: true })
  try { return await run(op.id, op.ctrl.signal) }
  finally { signal.removeEventListener('abort', cancel); if (active === op) active = null }
}
