const assert = require('node:assert/strict')
const { symlinkSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const {
  temporaryProfile,
  outsideRepository,
  artifactDirectory,
} = require('../support/fixtures.cjs')
const repository = resolve(__dirname, '../..')
for (const target of [
  repository,
  join(repository, 'reports'),
  join(repository, '..nested', 'report'),
]) {
  assert.throws(() => outsideRepository(target), /outside the repository/)
}
const temporary = temporaryProfile('np-artifact-paths-')
const alias = join(temporary, 'source-alias')
symlinkSync(repository, alias, process.platform === 'win32' ? 'junction' : 'dir')
const denied = join(alias, 'must-not-be-created')
assert.throws(() => artifactDirectory(denied), /outside the repository/)
assert.equal(existsSync(denied), false)
assert.equal(outsideRepository(join(temporary, 'new', 'report')), join(temporary, 'new', 'report'))
console.log('PASS artifact roots reject repository paths and junction descendants before writing')
