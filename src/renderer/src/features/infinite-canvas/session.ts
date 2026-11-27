import { shallowRef } from 'vue'
import type {
  CanvasImage,
  CanvasOperation,
  CanvasOperationOutput,
  CanvasPoint,
  CanvasSession,
} from '@shared/canvas-project'
import { freePosition } from './layout'

export * from '@shared/canvas-project'

export function allOperationOutputs(session: CanvasSession, node: CanvasOperation) {
  const outputs = node.outputs ?? []
  const key = (entry: Pick<CanvasOperationOutput, 'workspaceId' | 'versionId' | 'asset'>) =>
    entry.versionId ? JSON.stringify([entry.workspaceId, entry.versionId]) : entry.asset.name
  const known = new Set(outputs.map(key))
  const legacy: CanvasOperationOutput[] = []
  for (const image of session.images) {
    if (image.operationId !== node.id || image.asset.kind !== 'gallery') {
      continue
    }
    const output = {
      id: 'legacy-' + image.id,
      asset: image.asset,
      label: image.asset.label ?? image.asset.name,
      workspaceId: image.workspaceId,
      versionId: image.versionId,
      createdAt: image.asset.modifiedAt ?? 0,
    }
    const identity = key(output)
    if (!known.has(identity)) {
      legacy.push(output)
      known.add(identity)
    }
  }
  return legacy.length ? [...legacy, ...outputs] : outputs
}

export function activeOperationOutput(node: CanvasOperation, outputs = node.outputs ?? []) {
  return outputs.find((output) => output.id === node.activeOutputId) ?? outputs.at(-1)
}

export function fitInlineOutput(node: CanvasOperation, output?: CanvasOperationOutput) {
  const asset = output?.asset
  if (node.outputMode !== 'branch' && asset?.width && asset.height) {
    node.height = (node.width * asset.height) / asset.width
  }
}

export function extractOutputAsCanvasImage(
  session: CanvasSession,
  node: CanvasOperation,
  output = activeOperationOutput(node, allOperationOutputs(session, node)),
  atPoint?: CanvasPoint,
) {
  if (!output) {
    return
  }
  const ratio = (output.asset.width || 1) / (output.asset.height || 1)
  const image: CanvasImage = {
    id: session.nextImageId++,
    asset: { ...output.asset },
    workspaceId: output.workspaceId,
    versionId: output.versionId,
    x: node.x + node.width + 40,
    y: node.y,
    width: 300 * Math.min(1, ratio),
    height: 300 / Math.max(1, ratio),
  }
  if (atPoint) {
    image.x = atPoint.x - image.width / 2
    image.y = atPoint.y - image.height / 2
  } else {
    image.x = freePosition(session, image)
  }
  session.images.push(image)
  return session.images.at(-1)
}

export function ensureOutputBranch(
  session: CanvasSession,
  node: CanvasOperation,
  output: CanvasOperationOutput,
) {
  const linked = session.images.some(
    (image) =>
      image.operationId === node.id &&
      image.asset.kind === 'gallery' &&
      image.asset.name === output.asset.name &&
      image.versionId === output.versionId &&
      image.workspaceId === output.workspaceId,
  )
  if (!linked) {
    const image = extractOutputAsCanvasImage(session, node, output)
    if (image) {
      image.operationId = node.id
    }
  }
}

export type CanvasClipboardItem =
  | { kind: 'image'; image: CanvasImage }
  | { kind: 'operation'; node: CanvasOperation; source?: CanvasImage }

// 跨标签共享快照；粘贴时重新分配节点编号并解析底图。
export const canvasClipboard = shallowRef<CanvasClipboardItem>()
