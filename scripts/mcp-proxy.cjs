/**
 * NovelPrompt MCP 代理。
 *
 * 由 agent 以 Node 模式启动（同一个 NovelPrompt.exe / electron.exe，设置 ELECTRON_RUN_AS_NODE=1），
 * 再以正常模式拉起 `NovelPrompt.exe --mcp`，只把 JSON 行转发给 agent。
 * 原因：Electron 在 Windows 启动时会往 stdout 写一个空行，部分 MCP 客户端解析到非 JSON 内容会报错。
 *
 * 用法：<exe> mcp-proxy.cjs [应用目录（仅开发模式）]，环境变量 ELECTRON_RUN_AS_NODE=1
 */
const { spawn } = require('node:child_process')
const readline = require('node:readline')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [...process.argv.slice(2), '--mcp'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env,
  windowsHide: true
})

process.stdin.pipe(child.stdin)
process.stdin.on('end', () => child.stdin.end())

readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
  const t = line.trim()
  if (t.startsWith('{') || t.startsWith('[')) process.stdout.write(t + '\n')
  else if (t) process.stderr.write(`[novel-prompt] ${t}\n`)
})

child.on('error', (e) => {
  process.stderr.write(`[novel-prompt] 启动失败：${e.message}\n`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill())
