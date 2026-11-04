const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')
const { app, net } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-statistics-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
// These accounting fixtures explicitly approve simulated paid requests.
require('../../src/main/infrastructure/operation-policy.ts').setOperationAuthorizer(
  async () => true,
)
app.whenReady().then(async () => {
  try {
    const { readTokenUsage } = require('../../src/shared/statistics/model.ts')
    const { StatisticsStore, statistics } = require('../../src/main/modules/statistics/service.ts')
    const { TaskManager } = require('../../src/main/modules/tasks/task-manager.ts')
    const { requestChat } = require('../../src/main/providers/chat/client.ts')
    const { createTasksActions } = require('../../src/main/modules/tasks/task-actions.ts')
    const full = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 20 },
    }
    assert.equal(readTokenUsage(full).total, 150)
    assert.equal(
      readTokenUsage({
        prompt_cache_hit_tokens: 30,
        prompt_cache_miss_tokens: 20,
        completion_tokens: 10,
      }).input,
      50,
    )
    assert.equal(readTokenUsage(undefined).reported, 0)
    assert.equal(readTokenUsage({ prompt_tokens: 100 }).total, 100)
    assert.equal(readTokenUsage({ prompt_tokens: 100 }).reported, 0)
    assert.equal(readTokenUsage({ prompt_tokens: -1, completion_tokens: NaN }).reported, 0)
    let day = new Date(2026, 10, 1, 23, 59)
    const filename = join(profile, 'daily.json')
    const store = new StatisticsStore(
      () => filename,
      () => day,
    )
    store.record('optimize', (total) => {
      total.images++
    })
    day = new Date(2026, 10, 2, 0, 1)
    store.ai({
      provider: 'https://fixture',
      model: 'model',
      feature: 'optimize',
      usage: readTokenUsage(full),
    })
    assert.deepEqual(
      store.snapshot().days.map((row) => row.date),
      ['2026-11-01', '2026-11-02'],
    )
    assert.deepEqual(new StatisticsStore(() => filename).snapshot().days, store.snapshot().days)
    const legacy = store.snapshot()
    for (const day of legacy.days) {
      for (const totals of [
        day.totals,
        ...Object.values(day.features),
        ...day.models.map((m) => m.totals),
      ]) {
        delete totals.anlasSpent
        delete totals.anlasMeasured
        delete totals.anlasUnknown
      }
    }
    writeFileSync(filename, JSON.stringify(legacy))
    const migrated = new StatisticsStore(() => filename).snapshot()
    assert.equal(migrated.days[1].totals.total, 150)
    assert.equal(migrated.days[1].totals.anlasSpent, 0)
    const copy = store.snapshot()
    copy.days[0].totals.images = 999
    assert.equal(store.snapshot().days[0].totals.images, 1)
    store.clear()
    assert.deepEqual(new StatisticsStore(() => filename).snapshot().days, [])
    const tasks = new TaskManager(() => {})
    const settings = {
      apiKey: 'SECRET-NEVER-PERSIST',
      baseUrl: 'https://user:password@fixture.invalid/v1?secret=private',
      model: 'fixture-model',
      reasoningEffort: 'off',
    }
    // No real services: control responses while executing the actual client and task instrumentation.
    net.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body)
      const text = body.messages[0].content
      if (text === 'unknown') {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      }
      if (text === 'invalid-result') {
        return new Response(JSON.stringify({ usage: full }))
      }
      await new Promise((resolve) => setTimeout(resolve, text === 'slow' ? 20 : 1))
      return new Response(
        JSON.stringify({
          usage:
            text === 'small' ? { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } : full,
          choices: [{ message: { content: 'ok' } }],
        }),
      )
    }
    const call = (content) => requestChat([{ role: 'user', content }], settings)
    await Promise.all([
      tasks.run('optimize', async () => {
        await call('slow')
        await call('slow')
      }),
      tasks.run('preview', () => call('small')),
    ])
    assert.equal(tasks.snapshot().tasks.find((t) => t.kind === 'optimize').usage.total, 300)
    assert.equal(tasks.snapshot().tasks.find((t) => t.kind === 'preview').usage.total, 25)
    const snapshot = tasks.snapshot()
    snapshot.tasks[0].usage.total = 999
    assert.notEqual(tasks.snapshot().tasks[0].usage.total, 999)
    await tasks.run('optimize', () => call('unknown'))
    assert.equal(tasks.snapshot().tasks[0].usage.reported, 0)
    await assert.rejects(tasks.run('preview', () => call('invalid-result')))
    assert.equal(
      tasks.snapshot().tasks[0].usage.total,
      450,
      'all three billed retries survive invalid result',
    )
    let attempt = 0
    net.fetch = async () =>
      ++attempt === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        : new Response(JSON.stringify({ usage: full, choices: [{ message: { content: 'ok' } }] }))
    await tasks.run('optimize', () => call('retry'))
    assert.equal(tasks.snapshot().tasks[0].usage.requests, 2)
    assert.equal(tasks.snapshot().tasks[0].usage.reported, 1)
    assert.equal(tasks.snapshot().tasks[0].usage.total, 150)
    let started
    const requestStarted = new Promise((resolve) => {
      started = resolve
    })
    net.fetch = async (_url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        started()
      })
    const cancelled = tasks.run('preview', ({ signal }) =>
      requestChat([{ role: 'user', content: 'cancel' }], settings, { signal }),
    )
    const rejected = assert.rejects(cancelled, /已取消/)
    await requestStarted
    tasks.cancel(tasks.snapshot().tasks[0].id)
    await rejected
    assert.equal(tasks.snapshot().tasks[0].usage.requests, 1)
    assert.equal(tasks.snapshot().tasks[0].usage.reported, 0)
    const { saveSettings } = require('../../src/main/modules/settings/service.ts')
    saveSettings({ naiToken: 'fixture' })
    const provider = require('../../src/main/providers/novelai/client.ts')
    let balanceCalls = 0
    provider.readSubscription = async () => ({
      active: true,
      tier: 3,
      anlasFixed: 10000 - balanceCalls++ * 10,
      anlasPurchased: 0,
    })
    let generated = 0
    provider.generateOne = async () => {
      if (++generated === 2) {
        throw new Error('second image fails')
      }
      return Buffer.from('fake png')
    }
    require('../../src/main/modules/images/library.ts').storeGeneratedImage = () => ({
      name: 'fixture.png',
    })
    const { generateImages } = require('../../src/main/modules/generation/service.ts')
    const result = await tasks.run('generate', () =>
      generateImages(
        {
          base: 'scene',
          negative: '',
          characters: [],
          version: 'v5',
          params: {
            width: 832,
            height: 1216,
            steps: 23,
            scale: 5,
            count: 2,
            seed: null,
            qualityTags: false,
            ucPreset: 'none',
          },
        },
        () => {},
        () => false,
        { freeOnly: false },
      ),
    )
    assert.equal(result.images.length, 1)
    provider.generateOne = async () => {
      tasks.cancel(tasks.snapshot().tasks[0].id)
      return Buffer.from('fake png')
    }
    const stopped = await tasks.run(
      'generate',
      ({ signal }) =>
        generateImages(
          {
            base: 'scene',
            negative: '',
            characters: [],
            version: 'v5',
            params: {
              width: 832,
              height: 1216,
              steps: 23,
              scale: 5,
              count: 2,
              seed: null,
              qualityTags: false,
              ucPreset: 'none',
            },
          },
          () => {},
          () => signal.aborted,
          { freeOnly: false },
        ),
      { cancelMode: 'after-current' },
    )
    assert.equal(stopped.images.length, 1)
    assert.equal(tasks.snapshot().tasks[0].status, 'cancelled')
    const stats = statistics.snapshot()
    assert.equal(stats.days[0].totals.anlasSpent, 20)
    assert.equal(stats.days[0].totals.anlasMeasured, 2)
    const { recordAnlas } = require('../../src/main/modules/statistics/service.ts')
    recordAnlas('v5')
    recordAnlas('v5', { fixed: 100, purchased: 0 })
    assert.equal(
      statistics.snapshot().days[0].totals.anlasSpent,
      20,
      'recharge never reduces observed spending',
    )
    assert.equal(statistics.snapshot().days[0].totals.anlasUnknown, 1)
    assert.equal(
      stats.days.reduce((sum, d) => sum + d.totals.images, 0),
      2,
    )
    assert.equal(
      stats.days.reduce((sum, d) => sum + d.totals.total, 0),
      925,
    )
    const persisted = readFileSync(join(profile, 'data/statistics.json'), 'utf8')
    for (const sensitive of [
      'SECRET-NEVER-PERSIST',
      'password',
      'secret=private',
      'invalid-result',
    ]) {
      assert.ok(!persisted.includes(sensitive))
    }
    const api = createTasksActions({ tasks })
    api['tasks:clear']()
    assert.equal(api['statistics:get']().days[0].totals.total, 925)
    api['statistics:clear']()
    assert.deepEqual(api['statistics:get']().days, [])
    console.log(
      'PASS daily persistence/reset, safe aggregate storage, concurrent task attribution, cache subsets, retry/missing/error usage and partial image batches',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
