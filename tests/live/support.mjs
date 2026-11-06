import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { PNG } from 'pngjs'

/** Transport failures must settle pending calls instead of waiting ten minutes. */
export function liveClient(child, redact) {
  const waiting = new Map()
  let sequence = 0
  let errors = ''
  let closed = false
  const rejectAll = (error) => {
    closed = true
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    waiting.clear()
  }
  child.stderr.on('data', (chunk) => {
    errors = (errors + redact(String(chunk))).slice(-8000)
  })
  child.on('error', rejectAll)
  child.stdin.on('error', rejectAll)
  child.on('exit', (code) => rejectAll(new Error(`Proxy exited ${code}: ${errors}`)))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      rejectAll(new Error('MCP stdout contains invalid JSON'))
      return
    }
    const pending = waiting.get(message.id)
    if (pending) {
      clearTimeout(pending.timer)
      waiting.delete(message.id)
      pending.resolve(message)
    }
  })
  return (method, params = {}, timeoutMs = 600_000) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('MCP connection closed'))
        return
      }
      const id = ++sequence
      const timer = setTimeout(() => {
        waiting.delete(id)
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: id },
          }) + '\n',
        )
        reject(new Error(`Timeout ${method}; do not replay paid operations. ${errors}`))
      }, timeoutMs)
      waiting.set(id, { timer, resolve, reject })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}

export function imageEvidence(profile, image) {
  assert.ok(image?.path, 'MCP gallery supplies a stored image path')
  const path = relative(profile, image.path)
  assert.ok(path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
  const bytes = readFileSync(image.path)
  const png = PNG.sync.read(bytes, { checkCRC: true })
  assert.equal(png.width, image.width)
  assert.equal(png.height, image.height)
  assert.ok(png.width >= 64 && png.height >= 64, 'generation is not a placeholder thumbnail')
  return {
    name: image.name,
    path: image.path,
    width: png.width,
    height: png.height,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function checkInpaintPreservation(originalPath, editedPath, rectangles) {
  const original = PNG.sync.read(readFileSync(originalPath))
  const edited = PNG.sync.read(readFileSync(editedPath))
  assert.equal(edited.width, original.width)
  assert.equal(edited.height, original.height)
  let changed = 0
  for (let y = 0; y < original.height; y++) {
    for (let x = 0; x < original.width; x++) {
      const offset = (y * original.width + x) * 4
      const equal = original.data
        .subarray(offset, offset + 4)
        .equals(edited.data.subarray(offset, offset + 4))
      const selected = rectangles.some(
        (rectangle) =>
          x >= rectangle.x &&
          y >= rectangle.y &&
          x < rectangle.x + rectangle.width &&
          y < rectangle.y + rectangle.height,
      )
      if (!selected) {
        assert.ok(equal, `inpaint changed an unselected pixel at ${x},${y}`)
      } else if (!equal) {
        changed++
      }
    }
  }
  assert.ok(changed > 0, 'inpaint must change pixels inside the selection')
  return { changedSelectedPixels: changed, outsideSelectionUnchanged: true }
}

/** Remove only this run's copied settings (including backups) after the host exits. */
export function clearCredentials(profile) {
  for (const name of readdirSync(join(profile, 'data'))) {
    if (name === 'settings.json' || name.startsWith('settings.json.')) {
      rmSync(join(profile, 'data', name), { force: true })
    }
  }
}
