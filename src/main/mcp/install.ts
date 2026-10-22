import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { McpInstallResult, McpInstallState, McpInstallTarget } from '../../shared/types'

/**
 * 把 MCP 配置和 agent Skill 装进用户本机的 Codex / Claude Code。
 * 实际逻辑在 scripts/agent-setup.cjs（随安装包放在 resources/ 下），外部 agent 自助安装时也直接运行它，
 * 这里只是以 Node 模式调用同一个可执行文件去跑这份脚本，保证两边行为一致。
 */

export interface SetupOutput {
  ok: boolean
  error?: string
  portable: boolean
  launch: { command: string; args: string[]; env: Record<string, string> }
  skillSource: string
  results: McpInstallResult[]
  items: { target: McpInstallTarget; path: string; state: McpInstallState }[]
}

export function setupScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'agent-setup.cjs') : join(app.getAppPath(), 'scripts', 'agent-setup.cjs')
}

export function runSetup(args: string[]): SetupOutput {
  const r = spawnSync(process.execPath, [setupScript(), ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  })
  const line = (r.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{'))
  if (!line) throw new Error(`安装脚本没有输出：${(r.stderr || String(r.error ?? '')).trim().slice(0, 200)}`)
  return JSON.parse(line) as SetupOutput
}

export function installForAgents(targets: McpInstallTarget[]): McpInstallResult[] {
  const out = runSetup(['install', ...targets])
  if (out.error && !out.results.length) throw new Error(out.error)
  return out.results
}
