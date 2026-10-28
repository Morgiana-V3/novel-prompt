import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporaryProfile } from '../tests/support/fixtures.cjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const electron = require('electron')
const mode = process.argv[2] ?? 'quick'
const output = temporaryProfile('novel-prompt-check-')
const cases = {
  artifacts: ['node', 'tests/unit/artifact-paths.cjs', false],
  'electron:errors': ['node', 'tests/unit/electron-errors-smoke.cjs', false],
  'mcp:launch': ['node', 'tests/unit/mcp-launch-smoke.cjs', false],
  'mcp:relay': ['node', 'tests/integration/mcp-relay-smoke.cjs', false],
  'mcp:recovery': ['electron', 'tests/integration/mcp-recovery-smoke.cjs', false],
  'mcp:context': ['electron', 'tests/integration/mcp-context-smoke.cjs', false],
  'mcp:index': ['electron', 'tests/integration/mcp-index-smoke.cjs', false],
  'mcp:preview-cache': ['electron', 'tests/integration/mcp-preview-cache-smoke.cjs', false],
  'mcp:host': ['node', 'tests/e2e/mcp-host-smoke.mjs', true],
  startup: ['node', 'tests/e2e/workspace-startup-smoke.mjs', true],
  desktop: ['electron', 'tests/e2e/desktop-mcp-smoke.cjs', true],
  'desktop:lifecycle': ['electron', 'tests/e2e/desktop-lifecycle-smoke.cjs', false],
  pages: ['electron', 'tests/e2e/page-workspace-smoke.cjs', true],
  inpaint: ['electron', 'tests/e2e/inpaint-smoke.cjs', true],
  'inpaint:mcp': ['electron', 'tests/integration/inpaint-mcp-smoke.cjs', false],
  retention: ['electron', 'tests/integration/retention-smoke.cjs', false],
  'workspace:cleanup': ['electron', 'tests/integration/workspace-cleanup-smoke.cjs', false],
  skills: ['electron', 'tests/integration/skill-packages-smoke.cjs', true],
  'skills:builtins': ['electron', 'tests/integration/builtin-skills-smoke.cjs', false],
  'skills:templates': ['electron', 'tests/integration/skill-templates-smoke.cjs', false],
  'discussion:tools': ['electron', 'tests/integration/discussion-tools-smoke.cjs', false],
  prompt: ['electron', 'tests/e2e/prompt-smoke.cjs', true],
  tasks: ['electron', 'tests/e2e/tasks-smoke.cjs', true],
  update: ['electron', 'tests/integration/update-smoke.cjs', false],
}
const optionalCases = {
  'mcp:performance': ['electron', 'tests/integration/mcp-performance-smoke.cjs', false],
  isolation: ['node', 'tests/e2e/environment-isolation-smoke.mjs', true],
}
let selected = process.argv.slice(2)
if (mode === 'quick') {
  selected = ['artifacts', 'mcp:launch', 'mcp:relay', 'mcp:index', 'workspace:cleanup']
} else if (mode === 'full') {
  selected = Object.keys(cases)
}
for (const name of selected) {
  if (!cases[name] && !optionalCases[name]) {
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
      // Electron foreground regressions explicitly exercise show()/isVisible().
      // SW_HIDE inherited from CreateProcess suppresses the first native show.
      windowsHide: executable !== electron,
      stdio: ['ignore', descriptor, descriptor],
    })
    closeSync(descriptor)
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`${name} exceeded four minutes; logs: ${output}`))
    }, 240_000)
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
if (
  mode === 'quick' ||
  mode === 'full' ||
  selected.some((name) => (cases[name] ?? optionalCases[name])[2])
) {
  await run('build', process.execPath, [
    join(root, 'node_modules/electron-vite/bin/electron-vite.js'),
    'build',
  ])
}
for (const name of selected) {
  const [runtime, filename] = cases[name] ?? optionalCases[name]
  await run(name, runtime === 'electron' ? electron : process.execPath, [join(root, filename)])
}
console.log(`All ${selected.length} checks passed. Logs: ${output}`)
