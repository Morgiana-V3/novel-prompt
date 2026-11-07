const assert = require('node:assert/strict')
const { isReadonly, toRaw } = require('vue')
require('../support/register-typescript.cjs')

const storage = new Map()
global.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
}
const draft = require('../../src/renderer/src/features/prompts/public/draft.ts')
const internal = require('../../src/renderer/src/features/prompts/state.ts')
const navigation = require('../../src/renderer/src/features/creation/public/navigation.ts')
const session = require('../../src/renderer/src/features/creation/public/session.ts')
const tabs = require('../../src/renderer/src/features/creation/tabs.ts')
const notifications = require('../../src/renderer/src/shared/lib/notifications.ts')

assert.ok(isReadonly(draft.promptState))
assert.equal(toRaw(draft.promptState), toRaw(internal.promptState), 'one draft owner')
assert.equal(toRaw(navigation.creationTabs), toRaw(tabs.creationTabs), 'one tab owner')
const parameters = draft.promptState.params
const firstId = navigation.creationTabs.activeId
const first = {
  prompt: 'cat',
  negative: 'blurry',
  characters: [{ prompt: 'red hair', negative: '', position: 'A1' }],
  params: { ...draft.DEFAULT_PARAMS, width: 512 },
  history: [],
  lastPreview: null,
  focus: { kind: 'base' },
}
draft.restorePromptSession(first)
const result = session.tabRef('public-contract.result', () => '')
result.value = 'first-result'
assert.equal(navigation.createTab(), true)
assert.equal(draft.promptState.prompt, '')
assert.equal(result.value, '')
draft.updatePromptParams({ width: 1024 })
draft.setPromptFocus({ kind: 'negative' })
navigation.switchTab(firstId)
assert.equal(draft.promptState.prompt, 'cat')
assert.equal(result.value, 'first-result')
assert.equal(
  draft.promptState.params,
  parameters,
  'tab switches preserve shared control references',
)
assert.equal(parameters.width, 512)
assert.deepEqual(draft.promptState.focus, { kind: 'base' })
const snapshots = navigation.creationSnapshots()
snapshots[0].content.characters[0].prompt = 'changed copy'
assert.equal(
  draft.promptState.characters[0].prompt,
  'red hair',
  'blueprint reads cannot edit draft',
)
const release = session.lockTabs(() => 'running')
assert.equal(navigation.createTab(), false, 'public callers share the task switch guard')
release()
notifications.dismissToast()
console.log('PASS public feature state identity, tab restore, snapshots and switch guards')
