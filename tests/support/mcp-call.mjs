// Explicit single-tool runner for manual integration tests. Uses normal MCP gates.
// node tests/support/mcp-call.mjs <tool> <args.json> <response.json>
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [name, argsFile, output] = process.argv.slice(2)
if (!name || !argsFile || !output) {
  throw new Error('Expected tool, args.json, response.json')
}
const args = JSON.parse(readFileSync(argsFile, 'utf8'))
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const child = spawn(
  createRequire(import.meta.url)('electron'),
  [join(root, 'src/runtime/mcp-proxy.cjs'), root],
  {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
const waiting = new Map()
let nextId = 0
const lines = createInterface({ input: child.stdout })
lines.on('line', (line) => {
  const msg = JSON.parse(line)
  const pending = waiting.get(msg.id)
  if (pending) {
    clearTimeout(pending.timer)
    waiting.delete(msg.id)
    pending.resolve(msg)
  }
})
child.on('exit', (code) => {
  for (const p of waiting.values()) {
    clearTimeout(p.timer)
    p.reject(new Error(`MCP exited (${code})`))
  }
  waiting.clear()
})
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`${method} timed out`))
    }, 300000)
    waiting.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
try {
  await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'manual-inpaint-validation', version: '1' },
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const response = await call('tools/call', { name, arguments: args })
  writeFileSync(output, JSON.stringify(response, null, 2))
  if (response.error || response.result?.isError) {
    console.error(JSON.stringify(response))
    process.exitCode = 1
  } else {
    console.log(`${name}: saved response to ${resolve(output)}`)
  }
} finally {
  child.stdin.end()
  setTimeout(() => child.kill(), 3000).unref()
}
