// Build only isolated test installers. Baseline sources should be an extracted git archive.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { outsideRepository } from '../tests/support/fixtures.cjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const output = outsideRepository(
  resolve(process.env.NP_ACCEPTANCE_OUTPUT || join(tmpdir(), 'novel-prompt-acceptance')),
)
if (output === resolve(root) || output.startsWith(resolve(root) + sep)) {
  throw Error('Acceptance output must be outside the repository')
}
const baseline = resolve(process.argv[2] ?? join(output, 'baseline-source'))
outsideRepository(baseline)
if (!baseline.startsWith(output + sep)) {
  throw Error('Baseline must be inside the dedicated external acceptance directory')
}
const identity = {
  appId: 'com.holyxie.novelprompt.acceptance',
  productName: 'NovelPrompt Acceptance',
  createDesktopShortcut: false,
  createStartMenuShortcut: false,
  runAfterFinish: false,
}
async function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: 'inherit' })
  const [code] = await once(child, 'exit')
  if (code !== 0) {
    throw Error('Build failed: ' + code)
  }
}
for (const [label, cwd, folder] of [
  ['baseline', baseline, 'baseline-local'],
  ['current', root, 'current'],
]) {
  if (process.env.NP_ACCEPTANCE_TARGET && process.env.NP_ACCEPTANCE_TARGET !== label) {
    continue
  }
  const target = outsideRepository(join(output, folder))
  const sourceVersion = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version
  const version = label === 'current' ? `${sourceVersion}-acceptance.1` : sourceVersion
  if (!target.startsWith(output + sep)) {
    throw Error('Unsafe build target')
  }
  mkdirSync(target, { recursive: true })
  await run([join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'], cwd)
  const name = `NovelPrompt-Acceptance-${label}.exe`
  await run(
    [
      join(root, 'node_modules/electron-builder/cli.js'),
      '--win',
      'nsis',
      '--x64',
      '--publish',
      'never',
      `--config.electronDist=${join(root, 'node_modules/electron/dist')}`,
      `--config.directories.output=${target}`,
      `--config.appId=${identity.appId}`,
      `--config.productName=${identity.productName}`,
      '--config.nsis.createDesktopShortcut=false',
      '--config.nsis.createStartMenuShortcut=false',
      '--config.nsis.runAfterFinish=false',
      `--config.nsis.artifactName=${name}`,
      `--config.extraMetadata.version=${version}`,
    ],
    cwd,
  )
  writeFileSync(
    join(target, 'acceptance-build.json'),
    JSON.stringify(
      {
        ...identity,
        version,
        installer: name,
        sha256: createHash('sha256')
          .update(readFileSync(join(target, name)))
          .digest('hex'),
      },
      null,
      2,
    ),
  )
}
