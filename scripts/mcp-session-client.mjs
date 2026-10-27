// Persistent manual MCP client for multi-step live acceptance checks.
// Keeps connection-owned editor leases, rule caches and operation identities intact.
// No automatic retries of writes or generation requests.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export async function connectMcp(name = 'manual-live-acceptance') {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const child = spawn(createRequire(import.meta.url)('electron'), [join(root, 'scripts/mcp-proxy.cjs'), root], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  const pending = new Map(), events = []
  let sequence = 0, stderr = '', closed = false
  const fail = error => { closed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error) }; pending.clear() }
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-8000) })
  child.on('error', fail)
  child.on('exit', code => fail(Error(`MCP exited (${code}): ${stderr}`)))
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line), p = pending.get(message.id)
      if (p) { clearTimeout(p.timer); pending.delete(message.id); p.resolve(message) }
      else { events.push(message); if (events.length > 300) events.shift() }
    } catch (e) { fail(e) }
  })
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(Error('MCP connection is closed'))
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out; query the operation before any retry`)) }, 180000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const call = async (name, args = {}) => {
    const response = await request('tools/call', { name, arguments: args })
    if (response.error || response.result?.isError) throw Error(JSON.stringify(response.error ?? response.result))
    return response.result
  }
  const close = () => { child.stdin.end(); setTimeout(() => child.kill(), 3000).unref() }
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name, version: '1' } })
    if (initialized.error) throw Error(JSON.stringify(initialized.error))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    return { request, call, data: async (name, args = {}) => (await call(name, args)).structuredContent, events, close }
  } catch (e) { close(); throw e }
}

// JSON-lines controller for terminals that cannot retain a Node client object.
// Each command is {tool,args,saveAs}; full replies/images are saved, never dumped as base64.
if (process.argv[2] === '--interactive') {
  const folder = process.argv[3]
  if (!folder) throw Error('Expected an explicit output folder')
  mkdirSync(folder, { recursive: true })
  const client = await connectMcp()
  await client.data('configure_tools', { groups: ['workspace', 'images', 'skills', 'tags', 'frontend'] })
  writeFileSync(join(folder, 'catalog.json'), JSON.stringify((await client.request('tools/list')).result.tools, null, 2))
  console.log('READY ' + folder)
  let queue = Promise.resolve()
  const input = createInterface({ input: process.stdin })
  input.on('line', line => { queue = queue.then(async () => {
    try {
      const command = JSON.parse(line)
      if (command.close) { client.close(); input.close(); return }
      if (!/^[a-zA-Z0-9_-]+$/.test(command.saveAs)) throw Error('saveAs must be a simple filename stem')
      const args = command.argsFile ? JSON.parse(readFileSync(command.argsFile, 'utf8')) : command.args ?? {}
      if (command.freshState) {
        const state = (await client.data('get_app_state')).desktop
        if (!state || args.id && state.workspace?.id !== args.id) throw Error('The intended workspace is not the current window; inspect state before continuing')
        args.expected_token = state.token
      }
      const result = await client.call(command.tool, args)
      const path = join(folder, command.saveAs + '.json')
      writeFileSync(path, JSON.stringify(result, null, 2))
      const images = result.content.filter(c => c.type === 'image')
      images.forEach((image, i) => writeFileSync(join(folder, `${command.saveAs}-${i}.png`), Buffer.from(image.data, 'base64')))
      console.log(JSON.stringify({ tool: command.tool, path, imageCount: images.length, data: command.showData ? result.structuredContent : undefined }))
    } catch (e) { console.error(String(e)) }
  }) })
  input.on('close', () => { void queue.finally(() => client.close()) })
}
