const assert = require('node:assert/strict')
const { app, ipcMain, clipboard, ClipboardItem, BrowserWindow } = require('electron')
const { PNG } = require('pngjs')
const { readFileSync } = require('node:fs')
const { fileURLToPath } = require('node:url')
const { temporaryProfile } = require('../support/fixtures.cjs')
app.setPath('userData', temporaryProfile('np-clipboard-'))
require('../support/register-typescript.cjs')
app.whenReady().then(async () => {
  const saved = []
  let exitCode = 0
  let snapshotReady = false
  try {
    for (const item of await clipboard.read()) {
      const data = {}
      for (const type of item.types) {
        data[type] = await item.getType(type)
      }
      saved.push(new ClipboardItem(data))
    }
    snapshotReady = true
    const handlers = new Map()
    const originalHandle = ipcMain.handle
    ipcMain.handle = (name, fn) => handlers.set(name, fn)
    try {
      require('../../src/main/adapters/ipc/images.ts').registerImagesIpc({
        send() {},
        notifyAppChanged() {},
        getWindow() {
          return null
        },
      })
    } finally {
      ipcMain.handle = originalHandle
    }
    const library = require('../../src/main/modules/images/library.ts')
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(127)
    const recipe = {
      schema: 1,
      createdAt: Date.now(),
      sourceKind: 'generate',
      request: {
        base: 'cat, 原图信息',
        negative: 'blurry',
        characters: [],
        version: 'v5',
        params: {
          width: 64,
          height: 64,
          steps: 23,
          scale: 5,
          cfgRescale: 0,
          sampler: 'k_euler',
          noiseSchedule: 'native',
          seed: 123,
          count: 1,
          qualityTags: false,
          ucPreset: 'none',
        },
      },
    }
    const image = library.storeGeneratedImage(PNG.sync.write(png), recipe, 'saved')
    const expected = library.imageBytesWithRecipe(image.name)
    assert.equal(await handlers.get('nai:copyImage')({}, image.name), true)
    const copied = (await clipboard.read())[0]
    assert.ok(copied.types.includes('image/png'), 'image-only paste remains available')
    const blob = await copied.getType('text/uri-list')
    const copiedFile = fileURLToPath((await blob.text()).trim())
    assert.deepEqual(
      readFileSync(copiedFile),
      expected,
      'clipboard PNG must preserve every encoded byte, including recipe and alpha data',
    )
    const receiver = new BrowserWindow({ show: false })
    try {
      await receiver.loadURL('data:text/html,<textarea autofocus></textarea>')
      await receiver.webContents.executeJavaScript(`
        globalThis.pasteResult = new Promise(resolve => window.addEventListener('paste', async event => {
          const file = event.clipboardData.files[0]
          resolve(file ? Array.from(new Uint8Array(await file.arrayBuffer())) : [])
        }, { once: true }))
        document.querySelector('textarea').focus()
      `)
      receiver.webContents.paste()
      const pasted = await receiver.webContents.executeJavaScript(`Promise.race([
        globalThis.pasteResult, new Promise(resolve => setTimeout(() => resolve([]), 3000))
      ])`)
      assert.ok(
        Buffer.from(pasted).equals(expected),
        'native paste exposes the exact original PNG file',
      )
    } finally {
      receiver.destroy()
    }
    assert.equal(await handlers.get('nai:copyImage')({}, '../missing.png'), false)
    console.log('PASS original PNG clipboard round-trip preserves metadata and pixel bytes')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    if (snapshotReady) {
      if (saved.length) {
        await clipboard.write(saved)
      } else {
        clipboard.clear()
      }
    }
    app.exit(exitCode)
  }
})
