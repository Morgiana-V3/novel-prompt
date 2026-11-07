const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { dirname, resolve, join } = require('node:path')
const ts = require('typescript')
const { app, ipcMain } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')

const root = resolve(__dirname, '../..')
app.setPath('userData', temporaryProfile('np-architecture-contracts-'))
app.setAppPath(root)
require('../support/register-typescript.cjs')
const document = readFileSync(join(root, 'docs/architecture.md'), 'utf8').replaceAll('\r\n', '\n')

function documentedNames(heading) {
  const section = document.split(`## ${heading}\n`)[1]?.split('\n## ')[0]
  assert.ok(section, `Missing architecture section: ${heading}`)
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .flatMap((line) => [...line.split('|')[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]))
}

function sameNames(actual, documented, label) {
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate runtime registration`)
  assert.equal(new Set(documented).size, documented.length, `${label}: duplicate documentation`)
  assert.deepEqual([...actual].sort(), [...documented].sort(), `${label}: contract drift`)
}

function contractNames(name) {
  const path = join(root, 'src/shared/contracts/api.ts')
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), 99, true)
  const declaration = parsed.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
  )
  assert.ok(declaration, `Missing shared interface ${name}`)
  return declaration.members.map((member) => member.name.text)
}

// Discover assembly from the bootstrap AST. Tool factories can themselves use any
// registration pattern; the list is obtained from real MCP JSON-RPC dispatch below.
function bootstrapAssembly() {
  const path = join(root, 'src/main/app/bootstrap.ts')
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), 99, true)
  const imports = new Map()
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings) {
      const bindings = statement.importClause.namedBindings
      if (ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          imports.set(binding.name.text, {
            file: resolve(dirname(path), statement.moduleSpecifier.text) + '.ts',
            name: binding.propertyName?.text ?? binding.name.text,
          })
        }
      }
    }
  }
  const ipc = []
  let factories
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = imports.get(node.expression.text)
      if (imported && /^register.+Ipc$/.test(imported.name)) {
        ipc.push(node)
      }
      if (imported?.name === 'startMcpBridge') {
        const tools = node.arguments[2]
        assert.ok(
          ts.isArrayLiteralExpression(tools),
          'MCP assembly must be inspected after changes',
        )
        factories = tools.elements.map((element) => {
          assert.ok(ts.isSpreadElement(element) && ts.isCallExpression(element.expression))
          return element.expression
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(ipc.length && factories?.length, 'Application registration assembly was found')
  return { imports, ipc, factories }
}

app.whenReady().then(async () => {
  let session
  try {
    const { TaskManager } = require('../../src/main/modules/tasks/task-manager.ts')
    const { DesktopBridge } = require('../../src/main/adapters/desktop/bridge.ts')
    const { createMcpSession } = require('../../src/main/adapters/mcp/server.ts')
    const registered = []
    const originalHandle = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (name, handler) => {
      registered.push(name)
      originalHandle(name, handler)
    }
    const incoming = []
    const originalOn = ipcMain.on.bind(ipcMain)
    ipcMain.on = (name, listener) => {
      incoming.push(name)
      return originalOn(name, listener)
    }
    const desktop = new DesktopBridge(
      () => null,
      () => {},
    )
    const send = () => {}
    const tasks = new TaskManager(send)
    const context = {
      tasks,
      send,
      getWindow: () => null,
      notifyAppChanged: () => {},
      runtimeInfo: () => ({}),
      runtimeData: app.getPath('userData'),
      bridgeProfile: app.getPath('userData'),
    }
    const variables = { context, tasks, send, desktop, appState: () => ({}) }
    const assembly = bootstrapAssembly()
    function call(node) {
      assert.ok(ts.isIdentifier(node.expression), 'Expected an imported registration factory')
      const imported = assembly.imports.get(node.expression.text)
      assert.ok(imported, `Unresolved registration factory ${node.expression.text}`)
      const args = node.arguments.map((argument) => {
        assert.ok(
          ts.isIdentifier(argument) && Object.hasOwn(variables, argument.text),
          'New assembly dependency: supply an isolated test context',
        )
        return variables[argument.text]
      })
      return require(imported.file)[imported.name](...args)
    }
    for (const registration of assembly.ipc) {
      call(registration)
    }
    ipcMain.handle = originalHandle
    ipcMain.on = originalOn
    sameNames(registered, contractNames('IpcContract'), 'IPC implementation/shared')
    sameNames(incoming, contractNames('RendererMessages'), 'Renderer messages')
    sameNames([...registered, ...incoming], documentedNames('IPC 注册清单'), 'IPC documentation')
    sameNames(
      [...contractNames('AppEvents'), ...incoming],
      documentedNames('事件与窗口契约'),
      'Event documentation',
    )

    const tools = assembly.factories.flatMap(call)
    let sequence = 0
    const pending = new Map()
    session = createMcpSession(
      tools,
      { name: 'architecture-check', version: '1', instructions: '' },
      (line) => {
        const message = JSON.parse(line)
        pending.get(message.id)?.(message)
        pending.delete(message.id)
      },
      { initialGroups: 'all' },
    )
    const request = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++sequence
        pending.set(id, resolve)
        session.receive(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      })
    assert.ok(!(await request('initialize')).error)
    const listed = await request('tools/list')
    assert.ok(!listed.error, 'Actual MCP catalog request succeeded')
    const names = listed.result.tools.map((tool) => tool.name)
    const documented = documentedNames('MCP 工具名称清单')
    sameNames(names, documented, 'MCP documentation')
    // Both missing and obsolete documentation must fail, including factory-built tools.
    assert.throws(() => sameNames(names, documented.slice(1), 'missing'))
    assert.throws(() => sameNames(names, [...documented, 'obsolete_tool'], 'obsolete'))
    assert.ok(names.includes('ui_propose_creation_edit'), 'Factory registration is exercised')
    console.log(`PASS actual MCP catalog (${names.length}), IPC (${registered.length}) and events`)
    session.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    session?.close()
    app.exit(1)
  }
})
