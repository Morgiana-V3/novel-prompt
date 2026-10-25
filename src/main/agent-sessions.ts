import { AsyncLocalStorage } from 'node:async_hooks'
import type { PageAgentIdentity } from '../shared/page-workspace'

const current = new AsyncLocalStorage<PageAgentIdentity>()
const connected = new Map<string, PageAgentIdentity>()
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }
export function connectAgent(agent: PageAgentIdentity) { connected.set(agent.sessionId, agent); changed() }
export function disconnectAgent(id: string) { if (connected.delete(id)) changed() }
export function agentConnections() { return [...connected.values()] }
export function onAgentConnectionsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function runAsAgent<T>(agent: PageAgentIdentity, work: () => T): T { return current.run(agent, work) }
export function currentAgent() { return current.getStore() }
export function requireAgent() {
  const agent = currentAgent()
  if (!agent || !connected.has(agent.sessionId)) throw new Error('外部 Agent 未连接，请通过 MCP 重新接管')
  return agent
}
export function agentIsConnected(id?: string) { return !!id && connected.has(id) }
