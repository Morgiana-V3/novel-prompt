import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const document = () =>
  readFileSync(join(root, 'docs/architecture.md'), 'utf8').replaceAll('\r\n', '\n')
function source(filename) {
  return ts.createSourceFile(filename, readFileSync(filename, 'utf8'), 99, true)
}
function walk(node, visitor) {
  visitor(node)
  ts.forEachChild(node, (child) => walk(child, visitor))
}
function imports(parsed) {
  const result = new Map()
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        result.set(binding.name.text, {
          filename: resolve(dirname(parsed.fileName), statement.moduleSpecifier.text) + '.ts',
          name: binding.propertyName?.text ?? binding.name.text,
        })
      }
    }
  }
  return result
}
function namesInInterface(name) {
  const parsed = source(join(root, 'src/shared/contracts/api.ts'))
  const declaration = parsed.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
  )
  assert.ok(declaration, `Missing shared interface ${name}`)
  return declaration.members.map((member) => member.name.text)
}
function documentedNames(heading) {
  const section = document().split(`## ${heading}\n`)[1]?.split('\n## ')[0]
  assert.ok(section, `Missing architecture section: ${heading}`)
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .flatMap((line) => [...line.split('|')[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]))
}
function sameNames(actual, documented, label) {
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate registration`)
  assert.equal(new Set(documented).size, documented.length, `${label}: duplicate documentation`)
  assert.deepEqual([...actual].sort(), [...documented].sort(), `${label}: contract drift`)
}

/** Receives the complete tools/list response from the existing development host. */
export function assertMcpCatalog(tools) {
  assert.ok(Array.isArray(tools) && tools.length, 'Read the complete catalog from the running host')
  sameNames(
    tools.map((tool) => tool.name),
    documentedNames('MCP 工具名称清单'),
    'Live MCP catalog',
  )
  console.log(`PASS running-host MCP catalog (${tools.length} tools)`)
}

/** Analyze actual bootstrap registrations without constructing an app, TaskManager, or fixtures. */
export function assertIpcDocumentation() {
  const bootstrap = source(join(root, 'src/main/app/bootstrap.ts'))
  const assembly = imports(bootstrap)
  const modules = new Set()
  walk(bootstrap, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = assembly.get(node.expression.text)
      if (imported && /^register.+Ipc$/.test(imported.name)) {
        modules.add(imported.filename)
      }
    }
  })
  assert.ok(modules.size, 'Find the IPC assembly in bootstrap before checking contracts')
  const registered = []
  for (const filename of modules) {
    const parsed = source(filename)
    const dependencies = imports(parsed)
    const actionModules = new Set()
    walk(parsed, (node) => {
      if (!ts.isCallExpression(node)) {
        return
      }
      const imported = ts.isIdentifier(node.expression)
        ? dependencies.get(node.expression.text)
        : null
      if (imported?.name === 'handle') {
        assert.ok(ts.isStringLiteral(node.arguments[0]), 'Inspect a new dynamic IPC registration')
        registered.push(node.arguments[0].text)
      }
      if (imported && /^create.+Actions$/.test(imported.name)) {
        actionModules.add(imported.filename)
      }
    })
    for (const actionFile of actionModules) {
      walk(source(actionFile), (node) => {
        if (
          ts.isPropertyAssignment(node) &&
          ts.isStringLiteral(node.name) &&
          node.name.text.includes(':')
        ) {
          registered.push(node.name.text)
        }
      })
    }
  }
  const incoming = []
  const bridge = assembly.get('DesktopBridge')
  assert.ok(bridge, 'Find the actual desktop bridge assembly')
  walk(source(bridge.filename), (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText() === 'ipcMain' &&
      node.expression.name.text === 'on'
    ) {
      assert.ok(ts.isStringLiteral(node.arguments[0]), 'Inspect a new dynamic renderer channel')
      incoming.push(node.arguments[0].text)
    }
  })
  sameNames(registered, namesInInterface('IpcContract'), 'IPC source/shared')
  sameNames(incoming, namesInInterface('RendererMessages'), 'Renderer messages')
  sameNames([...registered, ...incoming], documentedNames('IPC 注册清单'), 'IPC documentation')
  sameNames(
    [...namesInInterface('AppEvents'), ...incoming],
    documentedNames('事件与窗口契约'),
    'Event documentation',
  )
  console.log(`PASS static IPC registration (${registered.length}) and event contracts`)
}
