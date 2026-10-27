import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { temporaryProfile } from '../tests/support/fixtures.cjs'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const output = temporaryProfile('novel-prompt-screenshots-')
async function run(executable, args, windowsHide) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide })
  const [code] = await once(child, 'exit')
  if (code !== 0) {
    throw new Error('Screenshot command failed: ' + code)
  }
}
await run(
  process.execPath,
  [join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
  true,
)
await run(
  require('electron'),
  ['.', '--screenshots=' + output, ...(process.argv.includes('--ai') ? ['--screenshots-ai'] : [])],
  false,
)
console.log('Screenshots: ' + output)
