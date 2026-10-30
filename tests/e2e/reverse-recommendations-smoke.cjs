// Offline interactive preview and UI regression checks. No model downloads or paid generation.
const { app, BrowserWindow, ipcMain, net } = require('electron')
const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-artist-preview-')
app.setPath('userData', profile)
app.disableHardwareAcceleration()
require('../support/register-typescript.cjs')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
const { rankArtists, proposeArtistStrings } = require('../../src/shared/reverse/candidates.ts')
saveSettings({ naiToken: 'offline-demo', naiVersion: 'v5' })
const preview = process.argv.includes('--preview')
const result = {
  tags: [{ name: '1girl', score: 0.98 }],
  characters: [],
  seconds: 2.4,
  warnings: [],
  style: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)),
  artists: [
    {
      model: 'Kaloscope 2',
      tags: [
        { name: 'saitou kakkou', score: 0.05 },
        { name: 'yamiochi umekichi', score: 0.047 },
        { name: 'aqua inc.', score: 0.008 },
        { name: 'keihh', score: 0.007 },
        { name: 'takahan', score: 0.006 },
        { name: 'rinnine39 (artist)', score: 0.004 },
      ],
    },
    {
      model: 'Kaloscope 3',
      tags: [
        { name: 'kaedemarine', score: 0.007 },
        { name: 'apple caramel', score: 0.005 },
        { name: 'dangorou (yushi-art)', score: 0.004 },
        { name: 'tyomimas', score: 0.0038 },
        { name: 'mizuki makoto', score: 0.0035 },
        { name: 'rinnine39 (artist)', score: 0.003 },
      ],
    },
  ],
}
const ranks = rankArtists(result)
assert.equal(new Set(ranks.map((r) => r.name)).size, ranks.length)
assert.equal(ranks.find((r) => r.name === 'rinnine39 (artist)').sources.length, 2)
assert.deepEqual(
  rankArtists({ artists: [...result.artists].reverse() }).map((r) => r.name),
  ranks.map((r) => r.name),
)
assert.deepEqual(
  proposeArtistStrings(result).slice(0, 3),
  ranks.slice(0, 3).map((r) => `artist:${r.name}`),
)
assert.deepEqual(rankArtists({ artists: [] }), [])
const assets = join(__dirname, '../../out/renderer/assets')
const illustration = readFileSync(
  join(
    assets,
    readdirSync(assets).find((name) => name.startsWith('avatar-') && name.endsWith('.png')),
  ),
)
const imageUrl = 'data:image/png;base64,' + illustration.toString('base64')
let generated = 0
net.fetch = async () => {
  throw new Error('Offline preview forbids network requests')
}
const handlers = {
  'settings:get': () => getSettings(),
  'settings:save': (_, patch) => saveSettings(patch),
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'db:status': () => ({ loaded: true, tagCount: 3 }),
  'nai:list': () => [],
  'recipes:list': () => [],
  'nai:freeCheck': () => ({ ok: true, reasons: [], notes: [] }),
  'nai:subscription': () => ({ active: true, tier: 3, anlasFixed: 9000, anlasPurchased: 0 }),
  'pages:list': () => [],
  'pages:removed': () => [],
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'reverse:status': () => ({
    phase: 'idle',
    ready: true,
    models: ['k2', 'k3', 'wd', 'pixai'].map((model) => ({
      model,
      name: model,
      ready: true,
      bytes: 1,
    })),
  }),
  'reverse:analyze': () => result,
  'nai:generate': () => ({
    images: [{ name: `demo-${++generated}.png`, url: imageUrl, createdAt: Date.now(), seed: 1 }],
    anlasDelta: 0,
  }),
  'reverse:score': () => [0.71, 0.86, 0.78][(generated - 1) % 3],
}
for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, fn)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    title: '画师推荐 · 离线演示（非真实识别与试图）',
    webPreferences: {
      preload: join(__dirname, '../../out/preload/index.js'),
      sandbox: false,
      offscreen: !preview,
      backgroundThrottling: false,
    },
  })
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const wait = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) {
        return
      }
      await delay(30)
    }
    throw new Error('Timed out: ' + code)
  }
  try {
    await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
    await wait(`document.querySelector('.nav-item')`)
    await js(
      `[...document.querySelectorAll('.nav-item')].find(el=>el.textContent.includes('图片反推')).click()`,
    )
    await js(
      `(async()=>{const bytes=Uint8Array.from(atob('${illustration.toString('base64')}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'离线演示.png',{type:'image/png'}));const input=document.querySelector('.reverse-view input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    )
    await wait(
      `document.querySelector('.reverse-run') && !document.querySelector('.reverse-run').disabled`,
    )
    await js(`document.querySelector('.reverse-run').click()`)
    await wait(`document.querySelectorAll('.recommendation').length===5`)
    assert.equal(await js(`document.querySelector('.recognition-details').open`), false)
    await js(`document.querySelector('.recommendation').click()`)
    await wait(`document.querySelector('.recommendation').getAttribute('aria-pressed')==='true'`)
    await js(`document.querySelector('.recommendation').click()`)
    await wait(`document.querySelector('.recommendation').getAttribute('aria-pressed')==='false'`)
    await js(`document.querySelector('.recognition-details').open=true`)
    assert.equal(await js(`document.querySelectorAll('.model-results section').length`), 2)
    await js(
      `document.querySelector('.recognition-details').open=false;document.querySelector('.artist-recommendations').scrollIntoView({block:'center'})`,
    )
    await delay(300)
    const rect = await js(
      `(()=>{const r=document.querySelector('.reverse-style-panel').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.min(Math.round(r.height),innerHeight-Math.round(r.y))}})()`,
    )
    writeFileSync(
      join(profile, 'recommendations.png'),
      (await win.webContents.capturePage(rect)).toPNG(),
    )
    await js(`document.querySelector('.reverse-next-step button').click()`)
    await js(`document.querySelector('.reverse-preview-actions .primary').click()`)
    await wait(
      `document.querySelector('.score-sort') && !document.querySelector('.score-sort').disabled`,
    )
    await js(`document.querySelector('.score-sort').click()`)
    await wait(`document.querySelector('.trial-thumbnail').textContent.includes('方案 2')`)
    await js(`document.querySelector('.trial-thumbnail').click()`)
    await wait(
      `document.querySelector('.comparison-images figure:nth-child(2) strong').textContent.includes('2')`,
    )
    assert.ok(
      await js(`document.querySelector('.trial-thumbnail').textContent.includes('本轮最接近')`),
    )
    writeFileSync(join(profile, 'comparison.png'), (await win.webContents.capturePage()).toPNG())
    console.log(
      'PASS fusion, unified recommendations, toggle selection, model details, trial effect sorting and stable selection. Artifacts:',
      profile,
    )
    if (preview) {
      await js(
        `[...document.querySelectorAll('.reverse-view button')].find(el=>el.textContent.trim()==='调整组合')?.click()`,
      )
      await js(
        `[...document.querySelectorAll('.reverse-adjustment-tabs button')].find(el=>el.textContent.trim()==='识别结果').click()`,
      )
      await js(`document.querySelector('.artist-recommendations').scrollIntoView({block:'center'})`)
      await js(`document.title='画师推荐 · 离线演示（非真实识别与试图）'`)
      win.show()
      win.focus()
      win.on('closed', () => app.quit())
    } else {
      app.exit(0)
    }
  } catch (error) {
    console.error(error)
    console.error(await js('document.body.innerText'))
    app.exit(1)
  }
})
