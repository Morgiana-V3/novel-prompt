const { mkdtempSync, realpathSync, mkdirSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, relative, isAbsolute, join, dirname, basename, sep } = require('node:path')

const repository = resolve(__dirname, '../..')

/** Resolve existing ancestors too, so a not-yet-created child cannot bypass a junction. */
function outsideRepository(directory) {
  const target = resolve(directory)
  let ancestor = target
  const tail = []
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      throw new Error('Cannot resolve artifact directory: ' + target)
    }
    tail.unshift(basename(ancestor))
    ancestor = parent
  }
  const canonical = resolve(realpathSync(ancestor), ...tail)
  const fromRepository = relative(realpathSync(repository), canonical)
  const outside =
    fromRepository === '..' || fromRepository.startsWith('..' + sep) || isAbsolute(fromRepository)
  if (!outside) {
    throw new Error('Test artifacts must stay outside the repository: ' + target)
  }
  return target
}

function temporaryProfile(prefix) {
  const parent = outsideRepository(realpathSync(tmpdir()))
  return mkdtempSync(join(parent, prefix))
}

function artifactDirectory(profile) {
  const target = outsideRepository(process.env.NP_TEST_ARTIFACTS || profile)
  mkdirSync(target, { recursive: true })
  outsideRepository(realpathSync(target))
  return target
}

module.exports = { temporaryProfile, artifactDirectory, outsideRepository }
