import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { PNG } from 'pngjs'

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
