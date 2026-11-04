const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { app } = require('electron')
require('../support/register-typescript.cjs')
const {
  requestConfirmation,
  replyConfirmation,
} = require('../../src/main/adapters/desktop/confirmations.ts')
class Owner extends EventEmitter {
  loading = false
  destroyed = false
  messages = []
  isDestroyed() {
    return this.destroyed
  }
  isLoading() {
    return this.loading
  }
  send(_channel, requests) {
    this.messages.push(requests)
  }
  last() {
    return this.messages.at(-1)
  }
}
const options = { title: '授权', message: '付费操作', confirmLabel: '允许本次' }
async function main() {
  const owner = new Owner()
  const first = requestConfirmation(owner, options)
  const id = owner.last()[0].id
  assert.throws(() => replyConfirmation(new Owner(), id, true), /失效/)
  replyConfirmation(owner, id, true)
  assert.equal(await first, true)
  assert.throws(() => replyConfirmation(owner, id, true), /失效/)
  assert.deepEqual(owner.last(), [])
  const ctrl = new AbortController()
  const cancelled = requestConfirmation(owner, options, ctrl.signal)
  ctrl.abort()
  assert.equal(await cancelled, false)
  const reload = requestConfirmation(owner, options)
  owner.emit('did-start-navigation', {}, '', false, true)
  assert.equal(await reload, false)
  owner.loading = true
  const loading = requestConfirmation(owner, options)
  assert.deepEqual(owner.last(), [])
  owner.loading = false
  owner.emit('did-finish-load')
  assert.equal(owner.last().length, 1)
  owner.destroyed = true
  owner.emit('destroyed')
  assert.equal(await loading, false)
  assert.equal(owner.listenerCount('did-finish-load'), 0)
  assert.equal(owner.listenerCount('destroyed'), 0)
  console.log(
    'PASS confirmation sender binding, single-use response, abort, reload, cold-window delivery and close cleanup',
  )
}
main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
