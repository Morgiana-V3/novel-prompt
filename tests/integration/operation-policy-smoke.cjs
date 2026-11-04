const assert = require('node:assert/strict')
const { app, net } = require('electron')
const fs = require('node:fs')
const { join } = require('node:path')
const { PNG } = require('pngjs')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-operation-policy-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
fs.mkdirSync(join(profile, 'data'))
fs.writeFileSync(join(profile, 'data/settings.json'), JSON.stringify({ naiFreeOnly: false }))
const settings = require('../../src/main/modules/settings/service.ts')
const policy = require('../../src/main/infrastructure/operation-policy.ts')
const { installOperationAuthorization } = require('../../src/main/app/operation-authorization.ts')
const { TaskManager } = require('../../src/main/modules/tasks/task-manager.ts')
let approve = false
let dialogs = []
let confirm
confirm = async (options) => {
  dialogs.push(options)
  return approve
}
installOperationAuthorization((options, signal) => confirm(options, signal))
const operation = {
  kind: 'future.service',
  provider: 'Fixture',
  description: '未知费用操作',
  quantity: 1,
  unit: 'credits',
}
const agent = (work, signal) => policy.withOperationContext({ origin: 'agent', signal }, work)
async function main() {
  assert.equal(
    settings.getSettings().agentFreeOnly,
    true,
    'old manual paid setting never grants Agent permission',
  )
  await assert.rejects(
    agent(() => policy.authorizePaidOperation(operation)),
    /未获用户授权/,
  )
  assert.match(dialogs.at(-1).detail, /暂无法估算/)
  approve = true
  await agent(() => policy.authorizePaidOperation(operation))
  approve = false
  await assert.rejects(
    agent(() => policy.authorizePaidOperation(operation)),
    /未获用户授权/,
    'one approval cannot be reused',
  )
  await assert.rejects(
    agent(() =>
      policy.withOperationContext({ origin: 'manual' }, () =>
        policy.authorizePaidOperation(operation),
      ),
    ),
    /Agent/,
  )
  const manager = new TaskManager(() => {})
  await assert.rejects(
    manager.run('agent', () => policy.authorizePaidOperation(operation), { origin: 'agent' }),
    /Agent/,
  )
  const ctrl = new AbortController()
  confirm = async () => {
    ctrl.abort()
    return true
  }
  await assert.rejects(
    agent(() => policy.authorizePaidOperation(operation), ctrl.signal),
    /已取消/,
  )
  confirm = async (options) => {
    dialogs.push(options)
    return approve
  }
  settings.saveSettings({ agentFreeOnly: false })
  const count = dialogs.length
  await agent(() => policy.authorizePaidOperation(operation))
  assert.equal(dialogs.length, count, 'explicit broad permission allows paid Agent calls')
  await assert.rejects(
    policy.authorizePaidOperation(operation),
    /已取消付费/,
    'manual still gets cost confirmation',
  )
  settings.saveSettings({ agentFreeOnly: true, naiToken: 'offline', apiKey: 'offline' })
  const provider = require('../../src/main/providers/novelai/client.ts')
  const service = require('../../src/main/modules/generation/service.ts')
  const bytes = PNG.sync.write(new PNG({ width: 64, height: 64 }))
  let requests = 0
  provider.upscaleOne = async () => {
    requests++
    return bytes
  }
  provider.generateOne = async () => {
    requests++
    return bytes
  }
  provider.readSubscription = async () => ({
    active: true,
    tier: 1,
    anlasFixed: 20,
    anlasPurchased: 0,
  })
  const params = {
    width: 64,
    height: 64,
    steps: 23,
    scale: 5,
    cfgRescale: 0,
    sampler: 'k_euler',
    noiseSchedule: 'native',
    seed: 1,
    count: 1,
    qualityTags: false,
    ucPreset: 'none',
  }
  const req = { base: 'cat', negative: '', characters: [], version: 'v5', params }
  const { upscaleImage } = require('../../src/main/modules/generation/image-tools.ts')
  await assert.rejects(
    agent(() => upscaleImage(bytes, null, () => {}, {})),
    /未获用户授权/,
  )
  assert.equal(requests, 0)
  approve = true
  await upscaleImage(
    bytes,
    { schema: 1, createdAt: Date.now(), sourceKind: 'generate', request: req },
    () => {},
    {},
  )
  assert.equal(requests, 1, 'manual paid upscale works even with Agent free-only enabled')
  assert.equal(dialogs.at(-1).title, '确认付费操作')
  approve = false
  await assert.rejects(
    agent(() =>
      service.generateImages(
        req,
        () => {},
        () => false,
      ),
    ),
    /未获用户授权/,
  )
  assert.equal(requests, 1)
  approve = true
  await service.generateImages(
    req,
    () => {},
    () => false,
  )
  assert.equal(requests, 2)
  provider.readSubscription = async () => ({
    active: true,
    tier: 3,
    usagePercent: 90,
    anlasFixed: 20,
    anlasPurchased: 0,
  })
  approve = false
  const before = dialogs.length
  await agent(() =>
    service.generateImages(
      req,
      () => {},
      () => false,
    ),
  )
  assert.equal(requests, 3)
  assert.equal(dialogs.length, before, 'free Agent generation needs no paid authorization')
  // Declining a later paid request must return already completed images to the workspace.
  provider.readSubscription = async () => ({
    active: true,
    tier: 1,
    anlasFixed: 20,
    anlasPurchased: 0,
  })
  let approvals = 0
  confirm = async () => ++approvals === 1
  const partial = await agent(() =>
    service.generateImages(
      { ...req, params: { ...params, count: 2 } },
      () => {},
      () => false,
    ),
  )
  assert.equal(partial.images.length, 1)
  assert.match(partial.stopped, /未获用户授权/)
  confirm = async (options) => {
    dialogs.push(options)
    return false
  }
  // A completed paid request reports the observed delta, remaining balance and quota separately.
  let reads = 0
  provider.readSubscription = async () => ({
    active: true,
    tier: 1,
    usagePercent: reads === 0 ? 80 : 79,
    anlasFixed: reads++ === 0 ? 20 : 18,
    anlasPurchased: 0,
  })
  const accountingSteps = []
  confirm = async (options) => {
    dialogs.push(options)
    return true
  }
  const accounted = await service.generateImages(
    req,
    (step) => accountingSteps.push(step),
    () => false,
  )
  assert.equal(accounted.anlasDelta, -2)
  assert.equal(accounted.usageDelta, -1)
  assert.equal(accounted.subscription.anlasFixed, 18)
  assert.match(dialogs.at(-1).detail, /预计消耗 2 Anlas/)
  assert.match(accountingSteps.at(-1), /余额减少 2 Anlas.*免费额度减少 1 个百分点.*剩余 18/)
  provider.readSubscription = async () => {
    throw new Error('fixture unavailable')
  }
  const unknown = await service.generateImages(
    req,
    () => {},
    () => false,
  )
  assert.equal(unknown.anlasDelta, undefined)
  assert.equal(unknown.usageDelta, undefined)
  confirm = async (options) => {
    dialogs.push(options)
    return false
  }
  const { requestChat } = require('../../src/main/providers/chat/client.ts')
  await assert.rejects(
    agent(() => requestChat([{ role: 'user', content: 'test' }], settings.getSettings())),
    /未获用户授权/,
  )
  assert.match(dialogs.at(-1).message, /AI 模型/)
  let chatRequests = 0
  let retryApprovals = 0
  confirm = async () => ++retryApprovals === 1
  net.fetch = async () => {
    chatRequests++
    return new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
  }
  await assert.rejects(
    agent(() => requestChat([{ role: 'user', content: 'retry' }], settings.getSettings())),
    /未获用户授权/,
  )
  assert.equal(chatRequests, 1, 'automatic retries cannot reuse the first paid authorization')
  assert.equal(retryApprovals, 2)

  console.log(
    'PASS manual paid confirmation, Agent free/paid/unknown policy, AI gate, migration, context propagation, one-shot approval and cancellation; no real network',
  )
}
main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
