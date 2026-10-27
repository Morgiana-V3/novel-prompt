import { AsyncLocalStorage } from 'node:async_hooks'
import type { PageAgentIdentity, PageAgentActivity } from '../shared/page-workspace'

const current = new AsyncLocalStorage<PageAgentIdentity>()
const connected = new Map<string, PageAgentIdentity>()
const listeners = new Set<() => void>()
const activity = new Map<string, Map<string, PageAgentActivity & { timer: ReturnType<typeof setTimeout> }>>()
const changed = () => { for (const listener of listeners) listener() }
export function connectAgent(agent: PageAgentIdentity) { connected.set(agent.sessionId, agent); changed() }
export function disconnectAgent(id: string) {
  for (const work of activity.get(id)?.values() ?? []) clearTimeout(work.timer)
  activity.delete(id)
  if (connected.delete(id)) changed()
}
export function agentConnections() { return [...connected.values()].map(agent => ({ ...agent, activity: [...(activity.get(agent.sessionId)?.values() ?? [])].filter(work => work.expiresAt > Date.now()).map(({ timer: _timer, ...work }) => work) })) }
export function agentActivity(sessionId: string | undefined, workspaceId: string, requestId: string | undefined) {
  const work = sessionId && connected.has(sessionId) ? activity.get(sessionId)?.get(workspaceId) : undefined
  return work && work.requestId === requestId && work.expiresAt > Date.now() ? { workspaceId: work.workspaceId, requestId: work.requestId, message: work.message, expiresAt: work.expiresAt } : null
}
/** A progress lease describes client-reported work, never inferred model activity. */
export function reportAgentActivity(workspaceId: string, requestId: string, phase: 'processing' | 'waiting', message: string) {
  const agent = requireAgent(), works = activity.get(agent.sessionId) ?? new Map()
  activity.set(agent.sessionId, works)
  clearTimeout(works.get(workspaceId)?.timer); works.delete(workspaceId)
  if (phase === 'processing') {
    const timer = setTimeout(() => { works.delete(workspaceId); changed() }, 120_000)
    timer.unref()
    works.set(workspaceId, { workspaceId, requestId, message, expiresAt: Date.now() + 120_000, timer })
  }
  changed()
  return agentActivity(agent.sessionId, workspaceId, requestId)
}
export function onAgentConnectionsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function runAsAgent<T>(agent: PageAgentIdentity, work: () => T): T { return current.run(agent, work) }
export function currentAgent() { return current.getStore() }
export function requireAgent() {
  const agent = currentAgent()
  if (!agent || !connected.has(agent.sessionId)) throw new Error('外部 Agent 未连接，请通过 MCP 重新接管')
  return agent
}
export function agentIsConnected(id?: string) { return !!id && connected.has(id) }
