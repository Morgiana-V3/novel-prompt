import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpInstallResult, McpInstallTarget } from '../../shared/types'
import { upsertTomlTable } from './toml'

/**
 * 把 MCP 配置和 agent Skill 装进用户本机的 Codex / Claude Code。
 * 路径都在运行时根据本软件实际安装位置生成，所以换了安装目录后重新点一次即可。
 */

const SERVER = 'novel-prompt'

/** 打包后的便携版每次运行都解压到临时目录，路径不固定，无法给 agent 配置 */
export const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE

export function proxyPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'mcp-proxy.cjs') : join(app.getAppPath(), 'scripts', 'mcp-proxy.cjs')
}

export function mcpLaunch(): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: app.isPackaged ? [proxyPath()] : [proxyPath(), app.getAppPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

export function bundledSkill(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'agent-skill', 'novel-prompt', 'SKILL.md')
    : join(app.getAppPath(), 'agent-skill', 'novel-prompt', 'SKILL.md')
}

const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')
const claudeHome = () => join(homedir(), '.claude')

export const SKILL_TARGETS: Record<'codexSkill' | 'claudeSkill', () => string> = {
  codexSkill: () => join(codexHome(), 'skills', SERVER, 'SKILL.md'),
  claudeSkill: () => join(claudeHome(), 'skills', SERVER, 'SKILL.md')
}

export const codexConfigPath = () => join(codexHome(), 'config.toml')

// TOML 字面量字符串（单引号）不处理反斜杠转义，适合 Windows 路径
const tomlStr = (s: string) => `'${s.replace(/'/g, "''")}'`

export function codexBlock(): string {
  const m = mcpLaunch()
  const env = Object.entries(m.env).map(([k, v]) => `${k} = ${tomlStr(v)}`)
  return `[mcp_servers.${SERVER}]\ncommand = ${tomlStr(m.command)}\nargs = [${m.args.map(tomlStr).join(', ')}]\nenv = { ${env.join(', ')} }`
}

/** 替换 config.toml 里已有的 [mcp_servers.novel-prompt] 段（含其子表），没有就追加到末尾 */
export const upsertCodexBlock = (toml: string): string => upsertTomlTable(toml, SERVER, codexBlock())

export function installForAgents(targets: McpInstallTarget[]): McpInstallResult[] {
  if (isPortable()) throw new Error('便携版每次运行的位置都不固定，无法配置给 agent，请使用安装版')
  const results: McpInstallResult[] = []
  for (const t of targets) {
    try {
      if (t === 'codexConfig') {
        const file = codexConfigPath()
        mkdirSync(dirname(file), { recursive: true })
        const old = existsSync(file) ? readFileSync(file, 'utf8') : ''
        if (old) copyFileSync(file, `${file}.bak`)
        writeFileSync(file, upsertCodexBlock(old), 'utf8')
        results.push({ target: t, ok: true, path: file })
      } else {
        const file = SKILL_TARGETS[t]()
        mkdirSync(dirname(file), { recursive: true })
        copyFileSync(bundledSkill(), file)
        results.push({ target: t, ok: true, path: file })
      }
    } catch (e) {
      results.push({ target: t, ok: false, path: '', error: String((e as Error)?.message ?? e) })
    }
  }
  return results
}

/** 各项是否已安装（Skill 文件存在 / config.toml 里有本服务且路径与当前一致） */
export function installState(): Record<McpInstallTarget, 'none' | 'ok' | 'stale'> {
  const skill = (f: string): 'none' | 'ok' | 'stale' => {
    if (!existsSync(f)) return 'none'
    try {
      return readFileSync(f, 'utf8') === readFileSync(bundledSkill(), 'utf8') ? 'ok' : 'stale'
    } catch {
      return 'stale'
    }
  }
  let codexConfig: 'none' | 'ok' | 'stale' = 'none'
  try {
    const toml = existsSync(codexConfigPath()) ? readFileSync(codexConfigPath(), 'utf8') : ''
    if (/\[\s*mcp_servers\s*\.\s*["']?novel-prompt["']?\s*\]/.test(toml))
      codexConfig = toml.replace(/\r\n/g, '\n').includes(codexBlock()) ? 'ok' : 'stale'
  } catch {
    /* 读不到按未安装处理 */
  }
  return {
    codexConfig,
    codexSkill: skill(SKILL_TARGETS.codexSkill()),
    claudeSkill: skill(SKILL_TARGETS.claudeSkill())
  }
}
