import { cases, legacyCases, legacyOptionalCases } from './check-cases.mjs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { closeSync, openSync, readFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const mode = process.argv[2] ?? 'quick'
// Log storage only: never override the running application's profile or settings.
const output = join(tmpdir(), `novel-prompt-validation-${randomUUID()}`)
mkdirSync(output, { recursive: true })
let selected = process.argv.slice(2)
if (mode === 'quick') {
  selected = ['contracts', 'tests:registration', 'reverse:artist-mix', 'mcp:readonly']
} else if (mode === 'full') {
  selected = ['contracts', 'tests:registration', 'reverse:artist-mix', 'live']
}
for (const name of selected) {
  if (legacyCases[name] || legacyOptionalCases[name]) {
    if (!cases[name]) {
      throw new Error(
        `${name} is a historical fixture and is not current acceptance. Use quick/full against the running development host.`,
      )
    }
  }
  if (!cases[name]) {
    throw new Error(`Unknown check: ${name}`)
  }
}

async function run(name, executable, args) {
  console.log(`Running ${name}`)
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const logPath = join(output, name.replaceAll(':', '-') + '.log')
  const startedAt = Date.now()
  const exitCode = await new Promise((resolve, reject) => {
    // Inherit a real file handle. A launcher disconnect must not leave Electron
    // writing console output to a closed pipe and displaying an EPIPE dialog.
    const descriptor = openSync(logPath, 'w')
    const child = spawn(executable, args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor],
    })
    closeSync(descriptor)
    const timeoutMs = name === 'live' ? 20 * 60_000 : 4 * 60_000
    const timeout = setTimeout(() => {
      child.kill()
      const uncertainty =
        name === 'live'
          ? ' Only the validation client was stopped; the existing host remains running. Paid-operation results may be unknown: inspect operation IDs and balances before retrying.'
          : ''
      reject(
        new Error(`${name} exceeded ${timeoutMs / 60_000} minutes.${uncertainty} Logs: ${output}`),
      )
    }, timeoutMs)
    const monitor = setInterval(() => {
      if (
        /App threw an error during load|TEST_MAIN_PROCESS_ERROR/.test(readFileSync(logPath, 'utf8'))
      ) {
        child.kill()
      }
    }, 1000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      clearInterval(monitor)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      clearInterval(monitor)
      resolve(code)
    })
  })
  const log = readFileSync(logPath, 'utf8')
  if (exitCode !== 0 || /App threw an error during load|TEST_MAIN_PROCESS_ERROR/.test(log)) {
    console.error(log)
    throw new Error(`${name} failed (${exitCode}); logs: ${output}`)
  }
  console.log(`PASS ${name} (${Date.now() - startedAt} ms)`)
}

console.log(`Logs: ${output}`)
if (mode === 'quick' || mode === 'full') {
  await run('format', process.execPath, [
    require.resolve('prettier/bin/prettier.cjs'),
    '--check',
    'src',
    'scripts',
    'tests',
    'eslint.config.mjs',
    'stylelint.config.mjs',
    'prettier.config.mjs',
    'electron.vite.config.ts',
  ])
  await run('lint', process.execPath, [
    join(root, 'node_modules/eslint/bin/eslint.js'),
    'src',
    'scripts',
    'tests',
    '--max-warnings',
    '0',
  ])
  await run('styles', process.execPath, [
    join(root, 'node_modules/stylelint/bin/stylelint.mjs'),
    'src/renderer/src/**/*.{css,less,vue}',
  ])
  await run('boundaries', process.execPath, [join(root, 'scripts/check-boundaries.mjs')])
}
await run('typecheck', process.execPath, [
  require.resolve('vue-tsc/bin/vue-tsc.js'),
  '--noEmit',
  '-p',
  'tsconfig.json',
])
// The current dev host owns out/: production compilation is an explicit npm run build.
for (const name of selected) {
  const [, filename, , args = []] = cases[name]
  await run(name, process.execPath, [join(root, filename), ...args])
}
console.log(`All ${selected.length} checks passed. Logs: ${output}`)
if (selected.includes('live')) {
  console.log('自动灰度已通过；MCP、AI 或工作台改动仍须完成并记录外部 Agent 的真实前台交互验收。')
}
