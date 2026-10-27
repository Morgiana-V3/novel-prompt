import type { Schema } from './schema'
import { type ToolGroup } from './tool-groups'

/**
 * 最小 MCP（Model Context Protocol）服务端：stdio 上的换行分隔 JSON-RPC 2.0。
 * 支持工具、进度、取消，以及当前应用状态资源和变化订阅。
 * stdout 只能写协议消息，日志一律写 stderr。
 */

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Schema
  outputSchema?: Schema
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  /** 返回不可用的原因（例如设置里没有开启），可用时返回 null */
  gate?: () => string | null
  run: (
    args: Record<string, unknown>,
    signal: AbortSignal,
    progress?: McpProgress,
  ) => Promise<string | McpResult>
}

export type McpProgress = (message: string, current?: number, total?: number) => void

export interface McpResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface McpSessionOptions {
  initialGroups?: ToolGroup[]
  execute?: (
    tool: McpTool,
    args: Record<string, unknown>,
    signal: AbortSignal,
    progress: McpProgress,
  ) => Promise<string | McpResult>
  state?: () => unknown
}

export interface ServerInfo {
  name: string
  version: string
  instructions: string
}

export type Id = string | number

export interface Message {
  jsonrpc: '2.0'
  id?: Id
  method?: string
  params?: Record<string, unknown>
}
