import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { writeFileAtomicAsync } from '../../infrastructure/atomic-file'
import { CANVAS_TOOLS, type CanvasSession, type CanvasBox } from '../../../shared/canvas-project'
import { imageBytesWithRecipe, libraryImagePath, storeReferenceImage } from './library'
import { favoriteImagePath } from './recipes'
import { pngSize } from '../../providers/novelai/png-response'

const magic = Buffer.from('NPCANVAS1\n')
const limit = 256 * 1024 * 1024
const maxManifest = 24 * 1024 * 1024
type Entry = { name: string; size: number }

function validBox(box: CanvasBox) {
  return (
    box &&
    Number.isSafeInteger(box.id) &&
    box.id > 0 &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width > 0 &&
    box.height > 0
  )
}

function validate(session: CanvasSession) {
  const camera = session?.camera
  if (
    !camera ||
    ![camera.x, camera.y, camera.zoom].every(Number.isFinite) ||
    camera.zoom < 0.15 ||
    camera.zoom > 4 ||
    !Array.isArray(session.images) ||
    !Array.isArray(session.operations)
  ) {
    throw new Error('画布视口或元素列表损坏')
  }
  const elements = [...session.images, ...session.operations]
  if (
    elements.length > 10000 ||
    !elements.every(validBox) ||
    new Set(elements.map((box) => box.id)).size !== elements.length
  ) {
    throw new Error('画布元素编号或尺寸无效')
  }
  for (const node of session.operations) {
    if (
      !Object.hasOwn(CANVAS_TOOLS, node.kind) ||
      typeof node.request?.base !== 'string' ||
      typeof node.request.negative !== 'string' ||
      !Array.isArray(node.request.characters) ||
      !node.request.params ||
      !node.margins ||
      !Array.isArray(node.strokes) ||
      !node.strokes.every(
        (stroke) =>
          Number.isFinite(stroke.radius) &&
          Array.isArray(stroke.points) &&
          stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      )
    ) {
      throw new Error('操作卡片数据损坏')
    }
  }
  session.nextImageId = Math.max(0, ...elements.map((box) => box.id)) + 1
}

function imageSlots(session: CanvasSession) {
  const slots = []
  for (const image of session.images) {
    if (image.asset?.kind !== 'gallery' || typeof image.asset.name !== 'string') {
      throw new Error('画布图片来源无效')
    }
    const asset = image.asset
    slots.push({
      name: asset.name,
      replace: (name: string) => {
        asset.name = name
      },
    })
  }
  for (const node of session.operations) {
    for (const output of node.outputs ?? []) {
      if (output?.asset?.kind === 'gallery' && typeof output.asset.name === 'string') {
        const asset = output.asset
        slots.push({
          name: asset.name,
          replace: (name: string) => {
            asset.name = name
          },
        })
      }
    }
    for (const ref of [
      ...(node.request.params.preciseReferences ?? []),
      ...(node.request.params.vibeReferences ?? []),
    ]) {
      slots.push({
        name: ref.imageName,
        replace: (name: string) => {
          ref.imageName = name
        },
      })
    }
  }
  return slots
}

export async function snapshotFavorite(id: string) {
  const path = favoriteImagePath(id)
  if (!path) {
    throw new Error('收藏的原图已缺失')
  }
  const bytes = await readFile(path)
  const size = pngSize(bytes)
  if (!size) {
    throw new Error('收藏的原图无效')
  }
  return { kind: 'gallery' as const, name: storeReferenceImage(bytes), ...size }
}

export async function saveCanvasFile(path: string, session: CanvasSession) {
  validate(session)
  const assets = new Map<string, Buffer>()
  const originals = new Map<string, string>()
  let total = 0
  for (const slot of imageSlots(session)) {
    let name = originals.get(slot.name)
    if (!name) {
      const source = libraryImagePath(slot.name)
      if (!source) {
        throw new Error('画布引用的图片缺失：' + slot.name)
      }
      if ((await stat(source)).size > limit - total) {
        throw new Error('项目超过 256 MB')
      }
      const bytes = imageBytesWithRecipe(slot.name)
      name = 'ref-' + createHash('sha256').update(bytes).digest('hex') + '.png'
      if (!assets.has(name)) {
        total += bytes.length
        assets.set(name, bytes)
      }
      originals.set(slot.name, name)
    }
    slot.replace(name)
  }
  const entries = Array.from(assets, ([name, bytes]) => ({ name, size: bytes.length }))
  const manifest = Buffer.from(JSON.stringify({ version: 1, session, entries }))
  if (manifest.length > maxManifest || magic.length + 4 + manifest.length + total > limit) {
    throw new Error('画布项目超出大小限制')
  }
  const length = Buffer.alloc(4)
  length.writeUInt32LE(manifest.length)
  await writeFileAtomicAsync(path, Buffer.concat([magic, length, manifest, ...assets.values()]))
}

export async function readCanvasFile(path: string): Promise<CanvasSession> {
  const handle = await open(path, 'r')
  let bytes: Buffer
  try {
    if ((await handle.stat()).size > limit) {
      throw new Error('画布项目超过 256 MB')
    }
    bytes = await handle.readFile()
  } finally {
    await handle.close()
  }
  if (!bytes.subarray(0, magic.length).equals(magic) || bytes.length < magic.length + 4) {
    throw new Error('无法识别此画布项目版本')
  }
  const length = bytes.readUInt32LE(magic.length)
  let offset = magic.length + 4 + length
  if (length > maxManifest || offset > bytes.length) {
    throw new Error('画布目录损坏')
  }
  const parsed = JSON.parse(bytes.toString('utf8', magic.length + 4, offset)) as {
    version: number
    session: CanvasSession
    entries: Entry[]
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error('画布格式无效')
  }
  validate(parsed.session)
  const chunks = new Map<string, Buffer>()
  for (const entry of parsed.entries) {
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 24 ||
      offset + entry.size > bytes.length
    ) {
      throw new Error('画布图片数据不完整')
    }
    const png = bytes.subarray(offset, offset + entry.size)
    const hash = createHash('sha256').update(png).digest('hex')
    if (entry.name !== 'ref-' + hash + '.png' || !pngSize(png) || chunks.has(entry.name)) {
      throw new Error('画布图片校验失败')
    }
    chunks.set(entry.name, png)
    offset += entry.size
  }
  const referenced = new Set(imageSlots(parsed.session).map((slot) => slot.name))
  if (
    offset !== bytes.length ||
    referenced.size !== chunks.size ||
    [...referenced].some((name) => !chunks.has(name))
  ) {
    throw new Error('画布资源目录不完整')
  }
  for (const png of chunks.values()) {
    storeReferenceImage(png)
  }
  return parsed.session
}
