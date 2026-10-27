const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Real window destruction and delayed IPC; no user profile or provider traffic.
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtempSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const ts = require('typescript')
app.setPath('userData', temporaryProfile('np-desktop-lifecycle-'))
app.disableHardwareAcceleration()
require('../support/register-typescript.cjs')
const { DesktopBridge } = require('../../src/main/adapters/desktop/bridge.ts')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    let win = new BrowserWindow({ show: false })
    await win.loadURL('data:text/html,<p>lifecycle fixture</p>')
    const bridge = new DesktopBridge(
      () => win,
      () => {},
    )
    const sender = win.webContents
    const pending = bridge.request('snapshot')
    const rejection = assert.rejects(pending, /窗口已关闭/)
    win.destroy()
    await rejection
    // Keep the destroyed window reference: optional chaining alone is insufficient.
    for (const channel of ['desktop:state', 'desktop:reply', 'desktop:cancel-frontend']) {
      assert.doesNotThrow(() => ipcMain.emit(channel, { sender }, { id: 'late', token: 'late' }))
    }
    assert.equal(bridge.connected(), false)
    assert.equal(bridge.visible(), false)
    assert.doesNotThrow(() => bridge.cancelVisibleAction('expired'))
    assert.equal(bridge.state, null)
    await assert.rejects(bridge.request('snapshot'), /窗口尚未打开/)
    await assert.rejects(bridge.capture(512, new AbortController().signal), /窗口未打开/)
    assert.doesNotThrow(() => bridge.disconnected())
    win = new BrowserWindow({ show: false })
    await win.loadURL('data:text/html,<p>replacement fixture</p>')
    ipcMain.emit('desktop:state', { sender }, { token: 'old-window' })
    assert.equal(bridge.state, null, 'old renderer cannot publish into replacement window')
    ipcMain.emit('desktop:state', { sender: win.webContents }, { token: 'new-window' })
    assert.equal(bridge.state.token, 'new-window')
    win.destroy()
    bridge.disconnected()
    console.log(
      'PASS pending request rejects on close, destroyed-window IPC is ignored, cancellation/capture are safe and old renderers cannot publish into replacement windows',
    )
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
