// 任务完成提醒：只在窗口不在前台时提醒值得等待的任务，失败给出原因，点击回到窗口。
const assert = require('node:assert/strict')
require('../support/register-typescript.cjs')
const { createTaskNotifier, NOTIFY_MIN_MS } = require('../../src/main/app/task-notifications.ts')

function fakeWindow() {
  const win = {
    focused: false,
    minimized: false,
    visible: true,
    flashing: [],
    shown: 0,
    focusListeners: [],
    isFocused: () => win.focused,
    isMinimized: () => win.minimized,
    isVisible: () => win.visible,
    flashFrame: (flag) => win.flashing.push(flag),
    show: () => win.shown++,
    focus: () => {
      win.focused = true
      win.focusListeners.splice(0).forEach((listener) => listener())
    },
    once: (_event, listener) => win.focusListeners.push(listener),
  }
  return win
}
const task = (id, patch = {}) => ({
  id,
  kind: 'generate',
  status: 'completed',
  message: '已完成',
  startedAt: 0,
  endedAt: NOTIFY_MIN_MS + 1000,
  cancelMode: 'after-current',
  ...patch,
})
const snapshot = (tasks) => ({ revision: 1, tasks })

const win = fakeWindow()
let enabled = true
const sent = []
const notify = createTaskNotifier({
  window: () => win,
  enabled: () => enabled,
  notify: (message) => sent.push(message),
})

// 第一次快照里已结束的任务是历史，不补发
notify(snapshot([task('old')]))
assert.equal(sent.length, 0)

// 窗口不在前台：生图完成后通知并闪烁
notify(snapshot([task('old'), task('a')]))
assert.equal(sent.length, 1)
assert.equal(sent[0].title, '生成图片已完成')
assert.deepEqual(win.flashing, [true])
// 同一任务不重复提醒
notify(snapshot([task('old'), task('a')]))
assert.equal(sent.length, 1)
// 点击通知回到窗口，回到前台后停止闪烁
sent[0].onClick()
assert.equal(win.shown, 1)
assert.deepEqual(win.flashing, [true, false])
console.log('PASS completed tasks notify once while the window is in the background')

// 用户正看着窗口时不打扰
notify(snapshot([task('b')]))
assert.equal(sent.length, 1)
// 最小化时仍提醒
win.focused = true
win.minimized = true
notify(snapshot([task('c', { kind: 'optimize', label: '智能优化' })]))
assert.equal(sent.at(-1).title, '智能优化已完成')
win.minimized = false
win.focused = false

// 失败带原因；取消、过短、后台杂项不提醒
notify(snapshot([task('d', { status: 'failed', message: 'NovelAI 余额不足' })]))
assert.equal(sent.at(-1).title, '生成图片失败')
assert.equal(sent.at(-1).body, 'NovelAI 余额不足')
const count = sent.length
notify(
  snapshot([
    task('e', { status: 'cancelled' }),
    task('f', { endedAt: NOTIFY_MIN_MS - 1 }),
    task('g', { kind: 'agent' }),
    task('h', { kind: 'update-check' }),
    task('i', { status: 'running', endedAt: undefined }),
  ]),
)
assert.equal(sent.length, count)
console.log('PASS failures carry their reason; cancelled, short and background tasks stay quiet')

// 关闭开关后不提醒
enabled = false
notify(snapshot([task('j')]))
assert.equal(sent.length, count)
console.log('PASS the setting turns reminders off')
console.log('All task notification checks passed.')
