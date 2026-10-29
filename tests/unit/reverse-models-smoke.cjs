require('../support/register-typescript.cjs')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { writeFile, readFile, readdir } = require('node:fs/promises')
const { join } = require('node:path')
const { temporaryProfile } = require('../support/fixtures.cjs')
const { ReverseModels } = require('../../src/main/modules/reverse/models.ts')

function modelFile(model, bytes) {
  const body = Buffer.alloc(bytes, model.charCodeAt(0))
  return {
    body,
    spec: {
      model,
      file: `${model}.onnx`,
      bytes,
      sha256: createHash('sha256').update(body).digest('hex'),
      url: `https://fixture.invalid/${model}`,
      name: model,
      source: 'test fixture',
      license: 'test fixture',
    },
  }
}

async function main() {
  // Keep the missing model first, as PixAI is in the production catalog.
  const fixtures = [modelFile('pixai', 64), modelFile('wd', 128), modelFile('k2', 32)]
  const specs = fixtures.map((fixture) => fixture.spec)
  const directory = temporaryProfile('novel-prompt-model-download-')
  for (const fixture of fixtures.slice(1)) {
    await writeFile(join(directory, fixture.spec.file), fixture.body)
  }
  const requests = []
  const progress = []
  const service = new ReverseModels(directory, specs, async (url) => {
    requests.push(url)
    const status = await service.status(['wd'])
    // Polling with a different selection must not change the active transfer total.
    progress.push([status.completedBytes, status.totalBytes])
    return new Response(fixtures.find((fixture) => fixture.spec.url === url).body)
  })
  const installing = service.install(undefined, ['pixai', 'wd', 'k2'])
  assert.equal(service.phase, 'verifying')
  assert.equal(service.completedBytes, 0)
  await installing
  assert.deepEqual(requests, [specs[0].url])
  assert.deepEqual(progress, [[0, 64]])
  let status = await service.status()
  assert.equal(status.ready, true)
  assert.equal(status.totalBytes, 64)
  assert.equal(status.completedBytes, 64)
  assert.deepEqual(await readFile(join(directory, specs[1].file)), fixtures[1].body)

  await service.install()
  status = await service.status()
  assert.equal(status.totalBytes, 0)
  assert.equal(status.completedBytes, 0)
  assert.equal(requests.length, 1)
  console.log(
    'PASS only missing files are fetched/count toward progress; all-ready check transfers zero bytes',
  )

  // Same-size corruption passes the quick UI check but must be repaired after hashing.
  await writeFile(join(directory, specs[1].file), Buffer.alloc(128, 0))
  await service.install()
  assert.deepEqual(requests, [specs[0].url, specs[1].url])
  assert.deepEqual(progress[1], [0, 128])
  status = await service.status()
  assert.equal(status.totalBytes, 128)
  assert.equal(status.completedBytes, 128)
  assert.deepEqual(await readFile(join(directory, specs[1].file)), fixtures[1].body)
  console.log('PASS corrupt files are included in repair size without redownloading valid models')

  const cancelDirectory = temporaryProfile('novel-prompt-model-cancel-')
  let cancelNext = true
  const cancelledRequests = []
  const cancelled = new ReverseModels(cancelDirectory, specs, async (url) => {
    cancelledRequests.push(url)
    if (cancelNext) {
      cancelNext = false
      cancelled.cancel()
    }
    return new Response(fixtures[0].body)
  })
  await cancelled.install(undefined, ['pixai'])
  status = await cancelled.status(['pixai'])
  assert.equal(status.phase, 'idle')
  assert.equal(status.ready, false)
  assert.equal(status.completedBytes, 0)
  assert.equal(status.totalBytes, 64)
  assert.deepEqual(await readdir(cancelDirectory), [])
  await cancelled.install(undefined, ['pixai'])
  status = await cancelled.status(['pixai'])
  assert.equal(status.ready, true)
  assert.equal(status.completedBytes, 64)
  assert.equal(status.totalBytes, 64)
  assert.deepEqual(cancelledRequests, [specs[0].url, specs[0].url])
  console.log(
    'PASS cancellation removes partial files; retry resets progress and respects model selection',
  )

  const importDirectory = temporaryProfile('novel-prompt-model-import-')
  await writeFile(join(importDirectory, specs[1].file), fixtures[1].body)
  const imported = new ReverseModels(importDirectory, specs, async () => {
    throw new Error('Import must not access the network')
  })
  await imported.install([join(directory, specs[0].file)], ['pixai', 'wd'])
  status = await imported.status(['pixai', 'wd'])
  assert.equal(status.phase, 'idle')
  assert.equal(status.ready, true)
  assert.equal(status.totalBytes, 64)
  assert.equal(status.completedBytes, 64)
  console.log('PASS local import counts only copied missing files and skips existing models')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
