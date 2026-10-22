/**
 * MCP 冒烟测试：按设置页给出的配置（Node 模式代理）启动，走一遍 initialize / tools/list / 几个只读工具。
 * 用法：npm run build && node scripts/mcp-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron')
const child = spawn(electron, [join(ROOT, 'scripts', 'mcp-proxy.cjs'), ROOT], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

const waiting = new Map()
let nextId = 1
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return console.error('[stdout 出现空行]')
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    console.error('[非协议输出]', line)
    return
  }
  waiting.get(msg.id)?.(msg)
  waiting.delete(msg.id)
})

function call(method, params = {}) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    waiting.set(id, resolve)
    setTimeout(() => reject(new Error(`${method} 超时`)), 60_000)
  })
}
const tool = async (name, args) => {
  const r = await call('tools/call', { name, arguments: args })
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error)
  console.log(`\n=== ${name}${r.result?.isError ? '（isError）' : ''} ===\n${text.slice(0, name === 'analyze_prompt' ? 6000 : 700)}`)
}

try {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
  console.log('initialize →', init.result.protocolVersion, init.result.serverInfo)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const list = await call('tools/list')
  console.log('tools →', list.result.tools.map((t) => t.name).join(', '))
  await tool('validate_tags', { tags: ['twin tails', 'silver hair', 'blue_eyez'] })
  await tool('search_tags', { queries: ['双马尾'] })
  await tool('analyze_prompt', {
    base: '2girls, outdoors, cherry blossoms, white thighhighs, thighhighs',
    characters: [{ prompt: 'girl, hatsune miku, red hair', position: 'B3' }, { prompt: 'girl, black hair, glasses', position: 'D3' }],
    negative: 'lowres, worst quality, glasses'
  })
  await tool('generate_image', { base: '1girl', confirm: true })
} catch (e) {
  console.error('失败：', e.message)
  process.exitCode = 1
} finally {
  child.stdin.end()
  setTimeout(() => child.kill(), 1500)
}
