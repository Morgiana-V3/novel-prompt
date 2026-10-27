export interface McpLogEntry {
  at: number
  tool: string
  ok: boolean
  ms: number
  summary: string
}

export interface McpInfo {
  serverName?: string
  runtime?: { mode: 'installed' | 'development'; dataPath: string; appPath: string }
  command: string
  args: string[]
  env: Record<string, string>
  packaged: boolean
  /** 便携版：路径不固定，无法配置给 agent */
  portable: boolean
  log: McpLogEntry[]
}
