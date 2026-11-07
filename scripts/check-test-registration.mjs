import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { cases, legacyCases, legacyOptionalCases, manualCases } from './check-cases.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const normalize = (filename) => relative(root, filename).replaceAll('\\', '/')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return files(path)
    }
    return /\.(?:cjs|mjs)$/.test(path) ? [path] : []
  })
}

/** Follow executable imports, not strings in comments, descriptions, or unused fixture data. */
function dependencies(filename) {
  const parsed = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), 99, true)
  const result = []
  function visit(node) {
    let argument
    if (ts.isImportDeclaration(node)) {
      argument = node.moduleSpecifier
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      argument = node.arguments[0]
    }
    if (argument && ts.isStringLiteralLike(argument) && argument.text.startsWith('.')) {
      const target = resolve(dirname(filename), argument.text)
      if (existsSync(target) && /\.(?:cjs|mjs)$/.test(target)) {
        result.push(target)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return result
}

const testFiles = ['unit', 'integration', 'e2e', 'live'].flatMap((directory) =>
  files(join(root, 'tests', directory)),
)
const entries = [
  ...Object.values(cases),
  ...Object.values(legacyCases),
  ...Object.values(legacyOptionalCases),
].map(([, filename]) => filename)
for (const [filename, reason] of Object.entries(manualCases)) {
  assert.ok(reason.trim(), `${filename} must document why it is opt-in`)
}
for (const filename of [...entries, ...Object.keys(manualCases)]) {
  assert.ok(existsSync(join(root, filename)), `Registered test does not exist: ${filename}`)
}
function unregistered(roots, inventory = testFiles) {
  const visited = new Set()
  function visit(filename) {
    if (visited.has(filename)) {
      return
    }
    visited.add(filename)
    for (const dependency of dependencies(filename)) {
      visit(dependency)
    }
  }
  for (const entry of roots) {
    visit(join(root, entry))
  }
  return inventory.filter((filename) => !visited.has(filename)).map(normalize)
}
const roots = [...entries, ...Object.keys(manualCases)]
assert.deepEqual(
  unregistered(roots),
  [],
  'Tests must be registered or imported by a registered test',
)
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
for (const [name, command] of Object.entries(scripts)) {
  assert.ok(
    !/tests\/(?:unit|integration|e2e)\//.test(command),
    `${name} must not launch historical fixtures; route acceptance through scripts/check.mjs`,
  )
}
console.log(`PASS test inventory (${testFiles.length} files; historical fixtures are not executed)`)
