// Exercise IPC task registration offline, without downloading models or updates.
const assert = require('node:assert/strict')
const { app, ipcMain, dialog } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')
app.setPath('userData', temporaryProfile('np-background-tasks-'))
require('../support/register-typescript.cjs')
const handlers = new Map()
ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
const invoke = (channel, ...args) => handlers.get(channel)({}, ...args)
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let model
require('../../src/main/modules/reverse/service.ts').ReverseService = class {
  constructor() {
    model = this
    this.phase = 'idle'
    this.message = ''
    this.completedBytes = 0
  }
  async status() {
    return { phase: this.phase }
  }
  async install(paths) {
    this.paths = paths
    this.phase = 'downloading'
    this.message = '下载模型测试进度'
    this.pending = deferred()
    await this.pending.promise
  }
  cancel() {
    this.phase = 'idle'
    this.pending.resolve()
  }
  async remove() {
    this.removed = true
  }
}
let publishUpdate
let download
let updateState = { stage: 'available', newer: true, latest: '1.0.0' }
require('../../src/main/modules/updates/service.ts').createAppUpdater = (publish) => {
  publishUpdate = publish
  return {
    snapshot: () => updateState,
    check: async () => updateState,
    download: () => {
      download = deferred()
      return download.promise
    },
  }
}
const { TaskManager } = require('../../src/main/modules/tasks/task-manager.ts')
const cleanup = require('../../src/main/modules/workspace/image-cleanup.ts')
let cleaning
cleanup.cleanRemovedPageImages = () => {
  cleaning = deferred()
  return cleaning.promise
}
const tasks = new TaskManager(() => {})
const context = { tasks, send() {}, notifyAppChanged() {}, getWindow: () => ({}) }
const latest = () => tasks.snapshot().tasks[0]
const settle = () => new Promise((resolve) => setImmediate(resolve))
app.whenReady().then(async () => {
  try {
    require('../../src/main/adapters/ipc/reverse.ts').registerReverseIpc(context)
    require('../../src/main/adapters/ipc/updates.ts').registerUpdatesIpc(context)
    require('../../src/main/adapters/ipc/workspace.ts').registerWorkspaceIpc(context)
    const clean = invoke('pages:cleanup-removed-images')
    assert.equal(latest().kind, 'page-cleanup')
    assert.equal(latest().status, 'running')
    tasks.cancel(latest().id)
    assert.equal(latest().status, 'running')
    cleaning.resolve({ removed: 2 })
    assert.deepEqual(await clean, { removed: 2 })
    assert.equal(latest().status, 'completed')
    await invoke('reverse:install', ['k3'])
    assert.equal(latest().kind, 'reverse-install')
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.equal(latest().message, '下载模型测试进度')
    tasks.cancel(latest().id)
    await settle()
    assert.equal(latest().status, 'cancelled')
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['fixture.onnx'] })
    await invoke('reverse:import', ['k3'])
    assert.deepEqual(model.paths, ['fixture.onnx'])
    model.phase = 'error'
    model.message = 'fixture checksum failure'
    model.pending.resolve()
    await settle()
    assert.equal(latest().status, 'failed')
    assert.match(latest().message, /checksum failure/)
    await invoke('reverse:remove', ['k3'])
    assert.equal(latest().status, 'completed')
    assert.equal(model.removed, true)
    await invoke('update:check', true)
    assert.equal(latest().kind, 'update-check')
    const downloading = invoke('update:download')
    updateState = { ...updateState, stage: 'downloading', percent: 37 }
    publishUpdate(updateState)
    assert.equal(latest().current, 37)
    tasks.cancel(latest().id)
    assert.equal(latest().status, 'running', 'non-cancellable download must remain running')
    updateState = { ...updateState, stage: 'error', error: 'fixture download failure' }
    download.resolve()
    await assert.rejects(downloading, /download failure/)
    assert.equal(latest().status, 'failed')
    const retry = invoke('update:download')
    updateState = { ...updateState, stage: 'ready', error: undefined }
    download.resolve()
    await retry
    assert.equal(latest().status, 'completed')
    console.log(
      'PASS model install/import progress, cancellation, failure, removal; update progress, non-cancellable state, failure and retry',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
