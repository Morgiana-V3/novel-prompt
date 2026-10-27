import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const normalize = (filename) => filename.replaceAll('\\', '/')
const failures = []
const graph = new Map()
for (const name of readdirSync(root)) {
  if (name === 'release-test' || name.startsWith('release-acceptance')) {
    failures.push('Test output in repository: ' + name)
  }
}
for (const filename of sourceFiles(join(root, 'tests'))) {
  if (
    !filename.endsWith('fixtures.cjs') &&
    /\bmkdtempSync\s*\(/.test(readFileSync(filename, 'utf8'))
  ) {
    failures.push(normalize(relative(root, filename)) + ' must use guarded temporaryProfile')
  }
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(filename)
    }
    return /\.(?:ts|vue|cjs|mjs)$/.test(filename) ? [filename] : []
  })
}

function resolveImport(filename, specifier) {
  const base = specifier.startsWith('@shared/')
    ? resolve(root, 'src/shared', specifier.slice('@shared/'.length))
    : resolve(dirname(filename), specifier)
  return [base, `${base}.ts`, `${base}.vue`, `${base}.cjs`, join(base, 'index.ts')].find(
    (candidate) => existsSync(candidate) && /\.(?:ts|vue|cjs|mjs)$/.test(candidate),
  )
}

for (const filename of sourceFiles(join(root, 'src'))) {
  const source = normalize(relative(root, filename))
  const fullText = readFileSync(filename, 'utf8')
  const text = filename.endsWith('.vue')
    ? (fullText.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '')
    : fullText
  const parsed = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  const edges = []
  const dependencies = []
  function collect(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined
        const bindings = clause?.namedBindings ?? node.exportClause
        const typeOnly =
          node.isTypeOnly ||
          clause?.isTypeOnly ||
          (bindings &&
            (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly))
        dependencies.push({ specifier: node.moduleSpecifier.text, typeOnly })
      }
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteralLike(argument)) {
        dependencies.push({ specifier: argument.text, typeOnly: false })
      }
    }
    if (
      source.startsWith('src/shared/') &&
      ts.isIdentifier(node) &&
      [
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'Blob',
        'File',
        'Response',
        'DecompressionStream',
        'HTMLCanvasElement',
      ].includes(node.text)
    ) {
      failures.push(
        `${source} uses platform capability ${node.text}; inject it at the process boundary`,
      )
    }
    ts.forEachChild(node, collect)
  }
  collect(parsed)
  for (const { specifier, typeOnly } of dependencies) {
    if (
      source.startsWith('src/shared/') &&
      (['electron', 'vue'].includes(specifier) || specifier.startsWith('node:'))
    ) {
      failures.push(`${source} depends on platform package ${specifier}`)
    }
    if (!specifier.startsWith('.') && !specifier.startsWith('@shared/')) {
      continue
    }
    const resolved = resolveImport(filename, specifier)
    if (!resolved) {
      if (!/\.(?:css|less|png|svg)$/.test(specifier)) {
        failures.push(`${source}: unresolved ${specifier}`)
      }
      continue
    }
    const target = normalize(relative(root, resolved))
    if (target.startsWith('tests/') || target.startsWith('scripts/')) {
      failures.push(`${source} imports non-production ${target}`)
    }
    if (source.startsWith('src/shared/') && !target.startsWith('src/shared/')) {
      failures.push(`${source} leaves platform-independent shared code: ${target}`)
    }
    if (source.startsWith('src/main/modules/') && /src\/main\/(?:adapters|app)\//.test(target)) {
      failures.push(`${source} imports application assembly or adapter ${target}`)
    }
    if (source.startsWith('src/main/adapters/') && target.startsWith('src/main/app/')) {
      failures.push(`${source} imports application assembly ${target}`)
    }
    if (
      source.startsWith('src/main/infrastructure/') &&
      /src\/main\/(?:modules|providers|adapters|app)\//.test(target)
    ) {
      failures.push(`${source} imports higher-level implementation ${target}`)
    }
    if (
      source.startsWith('src/main/providers/') &&
      /src\/main\/(?:modules|adapters|app)\//.test(target)
    ) {
      failures.push(`${source} imports application service ${target}`)
    }
    if (source.startsWith('src/renderer/') && /^src\/(?:main|preload)\//.test(target)) {
      failures.push(`${source} imports another process implementation ${target}`)
    }
    if (source.startsWith('src/main/') && /^src\/(?:renderer|preload)\//.test(target)) {
      failures.push(`${source} imports another process implementation ${target}`)
    }
    if (source.startsWith('src/preload/') && /^src\/(?:main|renderer)\//.test(target)) {
      failures.push(`${source} imports process implementation ${target}`)
    }
    if (
      source.startsWith('src/renderer/src/shared/') &&
      /src\/renderer\/src\/(?:app|features)\//.test(target)
    ) {
      failures.push(`${source} imports feature implementation ${target}`)
    }
    if (
      source.startsWith('src/renderer/src/features/') &&
      target.startsWith('src/renderer/src/app/')
    ) {
      failures.push(`${source} imports application assembly ${target}`)
    }
    if (!typeOnly) {
      edges.push(target)
    }
  }
  graph.set(source, edges)
}

const visited = new Set()
const active = new Set()
function visit(source, chain = []) {
  if (active.has(source)) {
    failures.push(`Runtime cycle: ${[...chain.slice(chain.indexOf(source)), source].join(' -> ')}`)
    return
  }
  if (visited.has(source)) {
    return
  }
  active.add(source)
  for (const target of graph.get(source) ?? []) {
    visit(target, [...chain, source])
  }
  active.delete(source)
  visited.add(source)
}
for (const source of graph.keys()) {
  visit(source)
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`PASS boundaries and runtime cycles (${graph.size} source files)`)
}
