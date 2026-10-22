/**
 * NovelPrompt 的 agent 接入安装器：把 MCP 配置和 Agent Skill 写进 Codex / Claude Code。
 * 软件设置页的「一键安装」和外部 agent 自助安装用的都是这一份脚本。
 *
 * 以 Node 模式运行 NovelPrompt.exe（不需要单独装 Node）：
 *   $env:ELECTRON_RUN_AS_NODE = '1'
 *   & "<安装目录>\NovelPrompt.exe" "<安装目录>\resources\agent-setup.cjs" install all | Out-String
 *
 * 命令：
 *   status                  查看各项安装状态，并输出 MCP 启动配置（默认）
 *   install <目标...>       安装；目标：codex / claude / all，或 codexConfig codexSkill claudeConfig claudeSkill
 * 输出：一行 JSON
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SERVER = 'novel-prompt'
const ALL = ['codexConfig', 'codexSkill', 'claudeConfig', 'claudeSkill']
const GROUPS = { codex: ['codexConfig', 'codexSkill'], claude: ['claudeConfig', 'claudeSkill'], all: ALL }

/* ---------- 路径 ---------- */

// 安装版：脚本在 resources/ 下；开发模式：脚本在项目的 scripts/ 下，exe 是 node_modules 里的 electron.exe
const devRoot = path.basename(__dirname) === 'scripts' && fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : null
const proxy = devRoot ? path.join(devRoot, 'scripts', 'mcp-proxy.cjs') : path.join(__dirname, 'mcp-proxy.cjs')
const skillSource = devRoot ? path.join(devRoot, 'agent-skill', SERVER, 'SKILL.md') : path.join(__dirname, 'agent-skill', SERVER, 'SKILL.md')

const launch = {
  command: process.execPath,
  args: devRoot ? [proxy, devRoot] : [proxy],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

// 便携版每次运行都解压到临时目录，路径会变
const tmp = path.resolve(os.tmpdir()).toLowerCase()
const portable = !!process.env.PORTABLE_EXECUTABLE_FILE || path.resolve(process.execPath).toLowerCase().startsWith(tmp)

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const paths = {
  codexConfig: path.join(codexHome, 'config.toml'),
  codexSkill: path.join(codexHome, 'skills', SERVER, 'SKILL.md'),
  // Claude Code 的用户级 MCP 配置（等同 claude mcp add -s user）
  claudeConfig: path.join(os.homedir(), '.claude.json'),
  claudeSkill: path.join(os.homedir(), '.claude', 'skills', SERVER, 'SKILL.md')
}

/* ---------- Codex：TOML ---------- */

// 字面量字符串（单引号）不处理反斜杠转义，适合 Windows 路径
const tomlStr = (s) => `'${String(s).replace(/'/g, "''")}'`
const codexBlock = () =>
  `[mcp_servers.${SERVER}]\ncommand = ${tomlStr(launch.command)}\nargs = [${launch.args.map(tomlStr).join(', ')}]\nenv = { ${Object.entries(launch.env)
    .map(([k, v]) => `${k} = ${tomlStr(v)}`)
    .join(', ')} }`

/** 替换 [mcp_servers.novel-prompt] 段（含子表），没有就追加；其他内容原样保留 */
function upsertToml(toml) {
  const head = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*["']?${SERVER}["']?\\s*(?:\\.[^\\]]*)?\\]\\s*(#.*)?$`)
  const out = []
  let skipping = false
  for (const line of toml.replace(/\r\n/g, '\n').split('\n')) {
    if (head.test(line)) {
      skipping = true
      continue
    }
    if (skipping && /^\s*\[/.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  const body = out.join('\n').replace(/\s+$/, '')
  return (body ? `${body}\n\n` : '') + codexBlock() + '\n'
}

/* ---------- Claude Code：JSON ---------- */

const claudeEntry = () => ({ type: 'stdio', command: launch.command, args: launch.args, env: launch.env })

function readJson(file) {
  if (!fs.existsSync(file)) return {}
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
  return text ? JSON.parse(text) : {}
}

/* ---------- 状态 ---------- */

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)

function state(target) {
  try {
    if (target === 'codexConfig') {
      const toml = read(paths.codexConfig)
      if (!toml || !new RegExp(`\\[\\s*mcp_servers\\s*\\.\\s*["']?${SERVER}["']?\\s*\\]`).test(toml)) return 'none'
      return toml.replace(/\r\n/g, '\n').includes(codexBlock()) ? 'ok' : 'stale'
    }
    if (target === 'claudeConfig') {
      const cur = readJson(paths.claudeConfig).mcpServers?.[SERVER]
      if (!cur) return 'none'
      return JSON.stringify(cur) === JSON.stringify(claudeEntry()) ? 'ok' : 'stale'
    }
    const skill = read(paths[target])
    if (skill == null) return 'none'
    return skill === read(skillSource) ? 'ok' : 'stale'
  } catch {
    return 'stale'
  }
}

/* ---------- 安装 ---------- */

function backup(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
}

function install(target) {
  const file = paths[target]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (target === 'codexConfig') {
    const old = read(file) ?? ''
    backup(file)
    fs.writeFileSync(file, upsertToml(old), 'utf8')
  } else if (target === 'claudeConfig') {
    const data = readJson(file) // 解析失败会抛错，不会覆盖用户的文件
    backup(file)
    data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER]: claudeEntry() }
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  } else {
    fs.copyFileSync(skillSource, file)
  }
}

/* ---------- 入口 ---------- */

function main() {
  const [cmd = 'status', ...rest] = process.argv.slice(2)
  const result = { ok: true, portable, launch, skillSource, results: [], items: [] }

  if (cmd === 'install') {
    if (portable) {
      result.ok = false
      result.error = '便携版每次运行的位置都不固定，无法配置给 agent，请使用安装版'
    } else {
      const targets = [...new Set((rest.length ? rest : ['all']).flatMap((t) => GROUPS[t] ?? (ALL.includes(t) ? [t] : [])))]
      if (!targets.length) {
        result.ok = false
        result.error = `未知的安装目标：${rest.join(' ')}（可选 codex / claude / all / ${ALL.join(' / ')}）`
      }
      for (const t of targets) {
        try {
          install(t)
          result.results.push({ target: t, ok: true, path: paths[t] })
        } catch (e) {
          result.ok = false
          result.results.push({ target: t, ok: false, path: paths[t], error: String(e?.message ?? e) })
        }
      }
    }
  } else if (cmd !== 'status') {
    result.ok = false
    result.error = `未知命令：${cmd}（可选 status / install）`
  }

  result.items = ALL.map((t) => ({ target: t, path: paths[t], state: state(t) }))
  process.stdout.write(JSON.stringify(result) + '\n')
  process.exitCode = result.ok ? 0 : 1
}

main()
