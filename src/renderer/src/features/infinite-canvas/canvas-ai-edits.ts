import type {
  CanvasAiCreateOperation,
  CanvasAiEdit,
  CanvasAiImageSummary,
  CanvasAiOperationSummary,
  CanvasAiSnapshot,
  CanvasAiUpdateOperation,
} from '@shared/canvas-ai'
import { REFERENCE_LABELS } from '@shared/generation/references'
import { freePosition } from './layout'
import {
  connectImageToOperation,
  disconnectImageFromOperation,
  newOperation,
  operationLabel,
  resolvedReferenceName,
} from './operations'
import type { CanvasBox, CanvasImage, CanvasOperation, CanvasPoint, CanvasSession } from './session'

const WORKFLOW_GAP_X = 96

export function buildCanvasAiSnapshot(session: CanvasSession, title: string): CanvasAiSnapshot {
  const imageIdByName = new Map<string, number>()
  for (const image of session.images) {
    if (image.asset.kind === 'gallery') {
      if (!imageIdByName.has(image.asset.name)) {
        imageIdByName.set(image.asset.name, image.id)
      }
      const alias = resolvedReferenceName(image.asset.name)
      if (!imageIdByName.has(alias)) {
        imageIdByName.set(alias, image.id)
      }
    }
  }

  const images: CanvasAiImageSummary[] = session.images.map((image) => ({
    id: image.id,
    label: image.asset.label ?? `图片 ${image.id}`,
    kind: image.asset.kind,
    galleryName: image.asset.kind === 'gallery' ? image.asset.name : undefined,
    width: image.asset.width,
    height: image.asset.height,
    x: Math.round(image.x),
    y: Math.round(image.y),
    operationId: image.operationId,
  }))

  const operations: CanvasAiOperationSummary[] = session.operations.map((node) => ({
    id: node.id,
    kind: node.kind,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: node.width,
    height: node.height,
    sourceId: node.sourceId,
    version: node.request.version,
    base: node.request.base,
    negative: node.request.negative,
    characters: node.request.characters.map((character) => ({ ...character })),
    params: {
      width: node.request.params.width,
      height: node.request.params.height,
      steps: node.request.params.steps,
      guidance: node.request.params.scale,
      sampler: node.request.params.sampler,
      seed: node.request.params.seed,
      count: node.request.params.count,
      qualityTags: node.request.params.qualityTags,
      qualityMode: node.request.params.qualityMode,
      ucPreset: node.request.params.ucPreset,
    },
    strength: node.strength,
    noise: node.noise,
    scale: node.scale,
    margins: { ...node.margins },
    hasMask: node.strokes.length > 0,
    preciseReferences: (node.request.params.preciseReferences ?? []).map((entry) => ({
      imageName: entry.imageName,
      imageId: imageIdByName.get(entry.imageName),
      mode: entry.mode,
      strength: entry.strength,
      fidelity: entry.fidelity,
    })),
    vibeReferences: (node.request.params.vibeReferences ?? []).map((entry) => ({
      imageName: entry.imageName,
      imageId: imageIdByName.get(entry.imageName),
      strength: entry.strength,
      information: entry.information,
    })),
    lastRunMessage: node.lastRun?.message,
  }))

  return { title, images, operations }
}

function applyFields(
  node: CanvasOperation,
  patch: Omit<CanvasAiCreateOperation, 'kind' | 'tempId' | 'afterTempId'> | CanvasAiUpdateOperation,
) {
  if (patch.base !== undefined) {
    node.request.base = patch.base
  }
  if (patch.negative !== undefined) {
    node.request.negative = patch.negative
  }
  if (patch.characters !== undefined) {
    node.request.characters = patch.characters.map((character) => ({ ...character }))
  }
  if (patch.version !== undefined) {
    node.request.version = patch.version
    if (patch.version === 'v5' && node.request.params.vibeReferences?.length) {
      node.request.params.vibeReferences = []
    }
  }
  if (patch.width !== undefined) {
    node.request.params.width = patch.width
  }
  if (patch.height !== undefined) {
    node.request.params.height = patch.height
  }
  if (patch.steps !== undefined) {
    node.request.params.steps = patch.steps
  }
  if (patch.guidance !== undefined) {
    node.request.params.scale = patch.guidance
  }
  if (patch.sampler !== undefined) {
    node.request.params.sampler = patch.sampler
  }
  if (patch.seed !== undefined) {
    node.request.params.seed = patch.seed
  }
  if (patch.count !== undefined) {
    node.request.params.count = patch.count
  }
  if (patch.qualityTags !== undefined) {
    node.request.params.qualityTags = patch.qualityTags
  }
  if (patch.qualityMode !== undefined) {
    node.request.params.qualityMode = patch.qualityMode
  }
  if (patch.ucPreset !== undefined) {
    node.request.params.ucPreset = patch.ucPreset
  }
  if (patch.strength !== undefined) {
    node.strength = patch.strength
  }
  if (patch.noise !== undefined) {
    node.noise = patch.noise
  }
  if (patch.scale !== undefined) {
    node.scale = patch.scale
  }
  if (patch.margins !== undefined) {
    node.margins = { ...node.margins, ...patch.margins }
  }
}

function wireSummary(image: CanvasImage, node: CanvasOperation, role: string): string {
  const imageTitle = image.asset.label ?? `图片 ${image.id}`
  return `连接 ${imageTitle} → ${operationLabel(node.kind)} #${node.id}（${role}）`
}

export async function applyCanvasAiEdit(
  session: CanvasSession,
  edit: CanvasAiEdit,
  anchorPoint: CanvasPoint,
): Promise<{ summaries: string[]; focusBoxes: CanvasBox[]; selectedId: number | null }> {
  const summaries: string[] = []
  const focusBoxes: CanvasBox[] = []
  const imagesById = new Map(session.images.map((image) => [image.id, image]))
  const createdByTempId = new Map<string, CanvasOperation>()
  let lastCreated: CanvasOperation | null = null
  let selectedId: number | null = null

  // 1. Update existing operations
  for (const update of edit.updateOperations ?? []) {
    const node = session.operations.find((item) => item.id === update.id)
    if (!node) {
      continue
    }
    if (update.kind && update.kind !== node.kind) {
      node.kind = update.kind
    }
    if (update.sourceImageId === null) {
      node.sourceId = null
    } else if (update.sourceImageId !== undefined && imagesById.has(update.sourceImageId)) {
      node.sourceId = update.sourceImageId
    }
    applyFields(node, update)
    focusBoxes.push(node)
    selectedId = node.id
    summaries.push(`更新 ${operationLabel(node.kind)} #${node.id}`)
  }

  // 2. Create new operations (chaining workflow nodes left-to-right cleanly)
  for (const spec of edit.createOperations ?? []) {
    const sourceImage =
      spec.sourceImageId !== undefined ? imagesById.get(spec.sourceImageId) : undefined
    const node = newOperation(spec.kind, session.nextImageId++, sourceImage)
    applyFields(node, spec)

    const predecessor =
      (spec.afterTempId ? createdByTempId.get(spec.afterTempId) : undefined) ??
      (sourceImage && !createdByTempId.size ? sourceImage : lastCreated)

    let targetX = anchorPoint.x - node.width / 2
    let targetY = anchorPoint.y - node.height / 2
    if (predecessor) {
      targetX = predecessor.x + predecessor.width + WORKFLOW_GAP_X
      targetY = predecessor.y
    }
    node.x = freePosition(session, { ...node, x: targetX, y: targetY })
    node.y = targetY

    session.operations.push(node)
    if (spec.tempId) {
      createdByTempId.set(spec.tempId, node)
    }
    lastCreated = node
    focusBoxes.push(node)
    if (sourceImage) {
      focusBoxes.push(sourceImage)
    }
    selectedId = node.id
    summaries.push(`新建 ${operationLabel(node.kind)} #${node.id}`)

    // Attach inline precise references declared directly on createOperations
    for (const ref of spec.preciseReferences ?? []) {
      const image = imagesById.get(ref.imageId)
      if (!image) {
        continue
      }
      await connectImageToOperation(node, image, 'precise')
      const entry = node.request.params.preciseReferences?.at(-1)
      if (entry) {
        if (ref.mode) {
          entry.mode = ref.mode
        }
        if (ref.strength !== undefined) {
          entry.strength = ref.strength
        }
        if (ref.fidelity !== undefined) {
          entry.fidelity = ref.fidelity
        }
      }
      focusBoxes.push(image)
      summaries.push(
        wireSummary(image, node, `精确参考 · ${REFERENCE_LABELS[ref.mode ?? 'character']}`),
      )
    }

    // Attach inline Vibe references declared directly on createOperations (V4.5 only)
    for (const vibe of spec.vibeReferences ?? []) {
      const image = imagesById.get(vibe.imageId)
      if (!image || node.request.version === 'v5') {
        continue
      }
      await connectImageToOperation(node, image, 'vibe')
      const entry = node.request.params.vibeReferences?.at(-1)
      if (entry) {
        if (vibe.strength !== undefined) {
          entry.strength = vibe.strength
        }
        if (vibe.information !== undefined) {
          entry.information = vibe.information
        }
      }
      focusBoxes.push(image)
      summaries.push(wireSummary(image, node, 'Vibe'))
    }
  }

  // 3. Connect explicit wires
  for (const wire of edit.connectWires ?? []) {
    const image = imagesById.get(wire.imageId)
    const node = wire.operationTempId
      ? createdByTempId.get(wire.operationTempId)
      : session.operations.find((item) => item.id === wire.operationId)
    if (!image || !node) {
      continue
    }
    await connectImageToOperation(node, image, wire.role)
    if (wire.role === 'img2img' || wire.role === 'source') {
      if (wire.strength !== undefined) {
        node.strength = wire.strength
      }
      if (wire.noise !== undefined) {
        node.noise = wire.noise
      }
      summaries.push(wireSummary(image, node, wire.role === 'img2img' ? '图生图' : '底图'))
    } else if (wire.role === 'precise') {
      const entry = node.request.params.preciseReferences?.at(-1)
      if (entry) {
        if (wire.mode) {
          entry.mode = wire.mode
        }
        if (wire.strength !== undefined) {
          entry.strength = wire.strength
        }
        if (wire.fidelity !== undefined) {
          entry.fidelity = wire.fidelity
        }
      }
      summaries.push(
        wireSummary(image, node, `精确参考 · ${REFERENCE_LABELS[wire.mode ?? 'character']}`),
      )
    } else if (wire.role === 'vibe') {
      const entry = node.request.params.vibeReferences?.at(-1)
      if (entry) {
        if (wire.strength !== undefined) {
          entry.strength = wire.strength
        }
        if (wire.information !== undefined) {
          entry.information = wire.information
        }
      }
      summaries.push(wireSummary(image, node, 'Vibe'))
    }
    focusBoxes.push(image, node)
    selectedId = node.id
  }

  // 4. Disconnect wires
  for (const wire of edit.disconnectWires ?? []) {
    const image = imagesById.get(wire.imageId)
    const node = session.operations.find((item) => item.id === wire.operationId)
    if (!image || !node) {
      continue
    }
    disconnectImageFromOperation(node, image, wire.role)
    summaries.push(`断开连线 ${operationLabel(node.kind)} #${node.id}`)
  }

  // 5. Remove explicitly requested operation boxes
  const removeIds = new Set(edit.removeOperationIds ?? [])
  if (removeIds.size) {
    const before = session.operations.length
    session.operations = session.operations.filter((item) => !removeIds.has(item.id))
    const removedCount = before - session.operations.length
    if (removedCount > 0) {
      summaries.push(`移除 ${removedCount} 个盒子`)
    }
    if (session.selectedId !== null && removeIds.has(session.selectedId)) {
      session.selectedId = null
    }
  }

  return { summaries, focusBoxes, selectedId }
}
