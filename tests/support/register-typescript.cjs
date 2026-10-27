// Existing smoke tests execute the same TS services as the application without
// starting another bundler. Keep this loader test-only and CommonJS-compatible.
require('./electron-errors.cjs')
const { readFileSync } = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  })
  module._compile(compiled.outputText, filename)
}
