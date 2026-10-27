// Isolated local previews: no credentials, network or generated user images.
const { app, net } = require('electron')
const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os')
const assert = require('node:assert/strict'), ts = require('typescript'), { PNG } = require('pngjs')
const profile = fs.mkdtempSync(join(tmpdir(), 'np-preview-cache-'))
app.setPath('userData', profile); app.getAppPath = () => join(__dirname, '..')
net.fetch = async () => { throw Error('Preview checks must never call a provider') }
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f)
const { inpaintTools, workspaceRectangleMask, workspaceInpaintPreview } = require('../src/main/mcp/inpaint-tools.ts')
const { imageDir } = require('../src/main/nai/client.ts')
const signal = new AbortController().signal
const prepare = inpaintTools().find(t => t.name === 'prepare_inpaint')
app.whenReady().then(async () => {
  try {
    const name = 'cache-source.png', path = join(imageDir(), name)
    const source = new PNG({ width: 128, height: 128 }); source.data.fill(255)
    fs.writeFileSync(path, PNG.sync.write(source))
    const rect = [{ x: 20, y: 30, width: 24, height: 32 }]
    const mask = workspaceRectangleMask(name, rect)
    const read = async (encoded = mask) => JSON.parse(await workspaceInpaintPreview(name, encoded, signal))
    const first = await read(), direct = JSON.parse(await prepare.run({ image_name: name, mask_base64: mask }, signal))
    for (const key of ['mask_path', 'preview_path']) assert.deepEqual(fs.readFileSync(first[key]), fs.readFileSync(direct[key]))
    assert.equal(first.selected_pixels, 24 * 32); assert.deepEqual(first.bounds, rect[0])
    const originalRead = PNG.sync.read, originalWrite = PNG.sync.write
    let decodes = 0, encodes = 0
    PNG.sync.read = (...args) => { decodes++; return originalRead(...args) }
    PNG.sync.write = (...args) => { encodes++; return originalWrite(...args) }
    for (let i = 0; i < 5; i++) assert.deepEqual(await read(), first)
    PNG.sync.read = originalRead; PNG.sync.write = originalWrite
    assert.equal(decodes, 0); assert.equal(encodes, 0)
    const other = await read(workspaceRectangleMask(name, [{ x: 50, y: 50, width: 8, height: 8 }]))
    assert.notEqual(other.preview_path, first.preview_path); assert.equal(other.selected_pixels, 64)
    // Same-size artifact corruption with restored timestamps cannot pass as a hit.
    let current = first
    for (const key of ['mask_path', 'preview_path']) {
      const before = fs.statSync(current[key]), bytes = fs.readFileSync(current[key]); bytes[bytes.length - 1] ^= 1
      fs.writeFileSync(current[key], bytes); fs.utimesSync(current[key], before.atime, before.mtime)
      const repaired = await read(); assert.notEqual(repaired[key], current[key]); PNG.sync.read(fs.readFileSync(repaired[key]))
      current = repaired
    }
    fs.unlinkSync(current.preview_path)
    const restored = await read(); assert.notEqual(restored.preview_path, current.preview_path)
    const saved = fs.readFileSync(path), stamp = fs.statSync(path)
    source.data[0] = 0; fs.writeFileSync(path, PNG.sync.write(source)); fs.utimesSync(path, stamp.atime, stamp.mtime)
    const changed = await read(); assert.notEqual(changed.preview_path, restored.preview_path)
    assert.equal(PNG.sync.read(fs.readFileSync(changed.preview_path)).data[0], 0)
    fs.unlinkSync(path); await assert.rejects(read())
    fs.writeFileSync(path, saved); assert.deepEqual(await read(), restored)
    await assert.rejects(read('not a png'), /PNG|base64|遮罩/)
    await assert.rejects(workspaceInpaintPreview('../settings.json', mask, signal), /image_name/)
    // Bounded metadata cache: evict old receipts without deleting still-referenced files.
    for (let i = 0; i < 65; i++) await read(workspaceRectangleMask(name, [{ x: i, y: 0, width: 1, height: 1 }]))
    assert.notEqual((await read()).preview_path, restored.preview_path)
    assert.ok(fs.existsSync(restored.preview_path))
    const large = new PNG({ width: 1024, height: 1024 })
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const i = (y * 1024 + x) * 4, c = (x * 13 + y * 7) % 256
      large.data.set([c, c, c, 255], i)
    }
    const largeName = 'benchmark.png'; fs.writeFileSync(join(imageDir(), largeName), PNG.sync.write(large))
    const largeMask = workspaceRectangleMask(largeName, [{ x: 220, y: 430, width: 280, height: 300 }])
    const measure = async fn => { const start = performance.now(); for (let i = 0; i < 5; i++) await fn(); return (performance.now() - start) / 5 }
    const beforeMs = await measure(() => prepare.run({ image_name: largeName, mask_base64: largeMask }, signal))
    await workspaceInpaintPreview(largeName, largeMask, signal)
    const afterMs = await measure(() => workspaceInpaintPreview(largeName, largeMask, signal))
    const report = { source: 'deterministic 1024x1024 fixture', iterations: 5, beforeMs, afterMs, cachedPngDecodes: decodes, cachedPngEncodes: encodes }
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
    console.log('PASS preview reuse, source/mask changes, artifact corruption/deletion, validation and bounded cache', JSON.stringify(report))
    app.exit(0)
  } catch (e) { console.error(e); app.exit(1) }
})
