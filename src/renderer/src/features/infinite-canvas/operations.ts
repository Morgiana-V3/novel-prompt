import { reactive } from 'vue'
import { estimateGeneration, estimateLabel, estimateUpscale } from '@shared/generation/pricing'
import type { PreciseReference } from '@shared/generation/references'
import type { VibeReference } from '@shared/generation/vibes'
import { pageCurrent, pageImageToolSize, type PageRegion } from '@shared/workspace/model'
import { cleanErr } from '../../shared/lib/format'
import { DEFAULT_GEN } from '../generation/public'
import { DEFAULT_PARAMS } from '../prompts/public/draft'
import {
  CANVAS_TOOLS,
  type CanvasAsset,
  type CanvasImage,
  type CanvasOperation,
  type CanvasSession,
  type CanvasTool,
} from './session'
import { refreshCanvasSubscription } from './use-canvas-subscription'

export const CANVAS_PALETTE_TOOLS = [
  'generate',
  'inpaint',
  'outpaint',
  'enhance',
  'upscale',
] as const

export type CanvasWireRole = 'img2img' | 'precise' | 'vibe' | 'source'

export function isGenerateKind(kind: CanvasTool): boolean {
  return kind === 'generate' || kind === 'img2img'
}

export function operationLabel(kind: CanvasTool): string {
  return isGenerateKind(kind) ? '生图' : CANVAS_TOOLS[kind]
}

export const referenceAliases = reactive(new Map<string, string>())

export function resolvedReferenceName(galleryName: string): string {
  return referenceAliases.get(galleryName) ?? galleryName
}

export function connectImageToOperation(
  node: CanvasOperation,
  image: CanvasImage,
  role: CanvasWireRole,
  overrideImageName?: string,
): void {
  if (role === 'source' || role === 'img2img') {
    node.sourceId = image.id
    if (node.kind === 'inpaint') {
      node.strokes = []
      if (image.asset.width && image.asset.height) {
        Object.assign(node.request.params, {
          width: image.asset.width,
          height: image.asset.height,
        })
      }
    }
    return
  }

  const asset = image.asset
  if (asset.kind !== 'gallery') {
    return
  }
  const imageName = overrideImageName ?? resolvedReferenceName(asset.name)

  if (role === 'precise') {
    node.request.params.vibeReferences = []
    const existing = node.request.params.preciseReferences ?? []
    if (
      !existing.some((entry) => entry.imageName === asset.name || entry.imageName === imageName)
    ) {
      const entry: PreciseReference =
        node.request.version === 'v4.5'
          ? { imageName: asset.name, mode: 'character', strength: 0.6, fidelity: 0.8 }
          : { imageName: asset.name, mode: 'character', strength: 1, preferSameOutfit: false }
      node.request.params.preciseReferences = [...existing, entry]
    }
    return
  }

  if (role === 'vibe') {
    node.request.params.preciseReferences = []
    const existing = node.request.params.vibeReferences ?? []
    if (
      !existing.some((entry) => entry.imageName === imageName || entry.imageName === asset.name)
    ) {
      const entry: VibeReference = {
        imageName,
        strength: 0.6,
        information: 1,
      }
      node.request.params.vibeReferences = [...existing, entry]
    }
  }
}

export function disconnectImageFromOperation(
  node: CanvasOperation,
  image: CanvasImage,
  role: CanvasWireRole,
): void {
  if (role === 'source' || role === 'img2img') {
    if (node.sourceId === image.id) {
      node.sourceId = null
      node.strokes = []
    }
    return
  }
  const asset = image.asset
  if (asset.kind !== 'gallery') {
    return
  }
  const alias = resolvedReferenceName(asset.name)
  if (role === 'precise') {
    node.request.params.preciseReferences = (node.request.params.preciseReferences ?? []).filter(
      (entry) => entry.imageName !== asset.name && entry.imageName !== alias,
    )
    return
  }
  if (role === 'vibe') {
    node.request.params.vibeReferences = (node.request.params.vibeReferences ?? []).filter(
      (entry) => entry.imageName !== asset.name && entry.imageName !== alias,
    )
  }
}

export const TOOL_ICONS = {
  generate: 'generate',
  img2img: 'generate',
  inpaint: 'tool-inpaint',
  outpaint: 'tool-outpaint',
  enhance: 'tool-enhance',
  upscale: 'tool-upscale',
} as const satisfies Record<CanvasTool, string>

export const TOOL_TONES = {
  generate: 'pink',
  img2img: 'blue',
  inpaint: 'pink',
  outpaint: 'amber',
  enhance: 'green',
  upscale: 'blue',
} as const satisfies Record<CanvasTool, 'pink' | 'blue' | 'amber' | 'green'>

export const runningCards = reactive(new WeakSet<CanvasOperation>())
export const cardErrors = reactive(new WeakMap<CanvasOperation, string>())

export function estimateOperationPrice(node: CanvasOperation, source?: CanvasAsset): string {
  const params = node.request.params
  let size = { width: params.width, height: params.height }
  if (node.kind === 'upscale') {
    const cost = estimateUpscale(source?.width ?? 0, source?.height ?? 0)
    return cost === undefined ? '费用待确认' : '预计 ' + cost + ' Anlas'
  }
  if (source?.width && source.height) {
    if (node.kind === 'enhance') {
      size = pageImageToolSize(
        { kind: 'enhance', scale: node.scale, strength: node.strength, noise: node.noise },
        source.width,
        source.height,
      )
    }
    if (node.kind === 'outpaint') {
      size = pageImageToolSize({ kind: 'outpaint', ...node.margins }, source.width, source.height)
    }
    if (node.kind === 'inpaint') {
      size = { width: source.width, height: source.height }
    }
  }
  const img2img = ['img2img', 'enhance'].includes(node.kind)
    ? { strength: node.strength }
    : undefined
  const inpaint = ['inpaint', 'outpaint'].includes(node.kind)
    ? { strength: node.kind === 'outpaint' ? 1 : node.strength }
    : undefined
  return estimateLabel(
    estimateGeneration({
      params: { ...params, ...size },
      version: node.request.version,
      img2img,
      inpaint,
    }),
  )
}

function defaultOperationBoxSize(kind: CanvasTool, source?: CanvasImage) {
  if (kind !== 'generate' && source && source.width > 0 && source.height > 0) {
    const ratio = source.width / source.height
    const maxSide = 256
    const width = Math.max(188, Math.round(maxSide * Math.min(1, ratio)))
    const height = Math.max(188, Math.round(maxSide / Math.max(1, ratio)))
    return { width, height }
  }
  return { width: 256, height: 224 }
}

export function newOperation(kind: CanvasTool, id: number, source?: CanvasImage): CanvasOperation {
  const { width, height } = defaultOperationBoxSize(kind, source)
  return {
    id,
    kind,
    x: 0,
    y: 0,
    width,
    height,
    sourceId: kind === 'generate' ? null : (source?.id ?? null),
    request: {
      base: '',
      negative: '',
      characters: [],
      version: 'v4.5',
      params: { ...DEFAULT_PARAMS, ...DEFAULT_GEN },
    },
    strength: kind === 'inpaint' ? 1 : 0.6,
    noise: 0,
    scale: 1,
    margins: { left: 0, right: 128, top: 0, bottom: 0 },
    strokes: [],
  }
}
function maskRegion(node: CanvasOperation, width: number, height: number): PageRegion {
  if (!node.strokes.length) {
    throw new Error('请先在底图上涂出重绘区域')
  }
  const mask = document.createElement('canvas')
  mask.width = width
  mask.height = height
  const ctx = mask.getContext('2d')!
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'white'
  ctx.strokeStyle = 'white'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of node.strokes) {
    const first = stroke.points[0]
    if (!first) {
      continue
    }
    const radius = stroke.radius * Math.min(width, height)
    ctx.beginPath()
    ctx.arc(first.x * width, first.y * height, radius, 0, 2 * Math.PI)
    ctx.fill()
    ctx.beginPath()
    ctx.lineWidth = 2 * radius
    ctx.moveTo(first.x * width, first.y * height)
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x * width, point.y * height)
    }
    ctx.stroke()
  }
  return {
    id: crypto.randomUUID(),
    label: 'AA',
    instruction: '',
    target: null,
    anchor: null,
    annotated: true,
    mask: mask.toDataURL('image/png').split(',')[1],
    accepted: null,
  }
}

export async function executeCard(session: CanvasSession, node: CanvasOperation, title: string) {
  if (runningCards.has(node)) {
    return
  }
  runningCards.add(node)
  try {
    const request = JSON.parse(JSON.stringify(node.request)) as CanvasOperation['request']
    const source = session.images.find((image) => image.id === node.sourceId)?.asset
    if (node.kind !== 'generate' && source?.kind !== 'gallery') {
      throw new Error('请选择画布上的一张底图')
    }
    if (!request.base.trim() && !request.characters.length && node.kind !== 'upscale') {
      throw new Error('请填写主提示词或角色提示词')
    }
    const draft = { base: request.base, negative: request.negative, characters: request.characters }
    const params = request.params
    let regions: PageRegion[] = []
    if (node.kind === 'inpaint' && source) {
      if (!source.width || !source.height || source.width * source.height > 4194304) {
        throw new Error('无法在此底图尺寸上绘制遮罩')
      }
      Object.assign(params, { width: source.width, height: source.height })
      regions = [maskRegion(node, params.width, params.height)]
    }
    const usesImg2Img =
      (node.kind === 'generate' && source?.kind === 'gallery') || node.kind === 'img2img'
    let workspace = await window.canvasApi.pagesCreate(
      source?.kind === 'gallery' && (usesImg2Img || node.kind !== 'generate') ? source.name : null,
      params,
      request.version,
      draft,
      'creation',
    )
    node.lastRun = { workspaceId: workspace.id, message: '已创建工作台' }
    workspace = await window.canvasApi.pagesEdit(workspace.id, workspace.revision, {
      type: 'notes',
      title: title + ' · ' + operationLabel(node.kind) + ' ' + node.id,
      goal: '',
      preserve: '',
      composer: '',
    })
    workspace = await window.canvasApi.pagesEdit(workspace.id, workspace.revision, {
      type: 'editor',
      versionId: pageCurrent(workspace).id,
      editor: { draft, params, model: request.version, regions, strength: node.strength },
    })
    if (request.collectionId) {
      workspace = await window.canvasApi.pagesEdit(workspace.id, workspace.revision, {
        type: 'collection',
        collectionId: request.collectionId,
      })
    }
    const before = new Set(workspace.versions.map((version) => version.id))
    node.lastRun.message = '正在执行'
    if (node.kind === 'outpaint') {
      workspace = await window.canvasApi.pagesImageTool(workspace.id, workspace.revision, {
        kind: 'outpaint',
        ...node.margins,
      })
    } else if (node.kind === 'enhance') {
      workspace = await window.canvasApi.pagesImageTool(workspace.id, workspace.revision, {
        kind: 'enhance',
        scale: node.scale,
        strength: node.strength,
        noise: node.noise,
      })
    } else if (node.kind === 'upscale') {
      workspace = await window.canvasApi.pagesImageTool(workspace.id, workspace.revision, {
        kind: 'upscale',
      })
    } else {
      const execution = usesImg2Img
        ? { kind: 'img2img' as const, regionId: null, strength: node.strength, noise: node.noise }
        : {
            kind: node.kind === 'inpaint' ? ('inpaint' as const) : ('generate' as const),
            regionId: regions[0]?.id ?? null,
          }
      workspace = await window.canvasApi.pagesGenerate(workspace.id, workspace.revision, execution)
    }
    let offset = 0
    const prior = session.images.filter((image) => image.operationId === node.id)
    if (prior.length) {
      offset = Math.max(0, ...prior.map((image) => image.x + image.width - node.x - node.width))
    }
    for (const version of workspace.versions) {
      const image = version.image
      if (!image || before.has(version.id)) {
        continue
      }
      const ratio = (image.width ?? 1) / (image.height ?? 1)
      const width = 300 * Math.min(1, ratio)
      const height = 300 / Math.max(1, ratio)
      session.images.push({
        id: session.nextImageId++,
        asset: {
          kind: 'gallery',
          name: image.name,
          label: operationLabel(node.kind) + ' · ' + version.label,
          width: image.width,
          height: image.height,
        },
        x: node.x + node.width + 40 + offset,
        y: node.y,
        width,
        height,
        operationId: node.id,
        workspaceId: workspace.id,
        versionId: version.id,
      })
      offset += width + 24
    }
    node.lastRun.message = workspace.messages.at(-1)?.text ?? '执行完成'
  } catch (error) {
    if (node.lastRun?.message === '正在执行') {
      node.lastRun.message = '执行未完成，请核对工作台记录：' + cleanErr(error)
    }
    throw error
  } finally {
    runningCards.delete(node)
    void refreshCanvasSubscription(true).catch(() => {})
  }
}
