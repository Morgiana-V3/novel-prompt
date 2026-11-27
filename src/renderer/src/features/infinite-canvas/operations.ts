import { reactive } from 'vue'
import { estimateGeneration, estimateLabel, estimateUpscale } from '@shared/generation/pricing'
import { V5_INPAINT_REFERENCE_NOTICE, type PreciseReference } from '@shared/generation/references'
import type { VibeReference } from '@shared/generation/vibes'
import {
  pageCurrent,
  pageImageToolSize,
  type PageImageTool,
  type PageRegion,
} from '@shared/workspace/model'
import { cleanErr } from '../../shared/lib/format'
import { toolBlockedReason } from '../workspace/image-tool-rules'
import { DEFAULT_GEN } from '../generation/public'
import { DEFAULT_PARAMS } from '../prompts/public/draft'
import {
  CANVAS_TOOLS,
  activeOperationOutput,
  allOperationOutputs,
  ensureOutputBranch,
  fitInlineOutput,
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
    const output = activeOperationOutput(node)
    if (node.outputMode !== 'branch' && output) {
      fitInlineOutput(node, output)
    } else {
      fitOperationBoxToImage(node, image)
    }
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

function imageTool(node: CanvasOperation): PageImageTool | undefined {
  if (node.kind === 'enhance') {
    return { kind: node.kind, scale: node.scale, strength: node.strength, noise: node.noise }
  }
  if (node.kind === 'outpaint') {
    return { kind: node.kind, ...node.margins }
  }
  if (node.kind === 'upscale') {
    return { kind: node.kind }
  }
}

export function operationSize(node: CanvasOperation, source?: CanvasAsset) {
  if (isGenerateKind(node.kind)) {
    const { width, height } = node.request.params
    return { width, height }
  }
  if (!source?.width || !source.height) {
    return undefined
  }
  const tool = imageTool(node)
  return tool
    ? pageImageToolSize(tool, source.width, source.height)
    : { width: source.width, height: source.height }
}

export function estimateOperationPrice(node: CanvasOperation, source?: CanvasAsset): string {
  const params = node.request.params
  const size = operationSize(node, source)
  if (!size) {
    return '费用待确认'
  }
  if (node.kind === 'upscale') {
    const cost = estimateUpscale(source?.width ?? 0, source?.height ?? 0)
    return cost === undefined ? '费用待确认' : '预计 ' + cost + ' Anlas'
  }
  const img2img =
    (isGenerateKind(node.kind) && source) || node.kind === 'enhance'
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

export function imageAspectRatio(image: CanvasImage, node?: CanvasOperation): number {
  const size =
    image.asset.width && image.asset.height
      ? { width: image.asset.width, height: image.asset.height }
      : image
  const { width, height } = size
  if (node?.kind === 'outpaint') {
    const total = pageImageToolSize({ kind: 'outpaint', ...node.margins }, width, height)
    return total.width / total.height
  }
  return width / height
}

export function fitOperationBoxToImage(node: CanvasOperation, image: CanvasImage) {
  node.width = node.width || 256
  node.height = Math.max(120, Math.min(560, Math.round(node.width / imageAspectRatio(image, node))))
}

export function newOperation(kind: CanvasTool, id: number, source?: CanvasImage): CanvasOperation {
  const node: CanvasOperation = {
    id,
    kind,
    x: 0,
    y: 0,
    width: 256,
    height: 224,
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
    margins: { left: 0, right: 0, top: 0, bottom: 0 },
    strokes: [],
    outputMode: 'inline',
    outputs: [],
  }
  if (isGenerateKind(kind)) {
    node.strength = 0.7
    node.noise = 0.2
  }
  if (kind === 'enhance') {
    node.scale = 1.5
    node.strength = 0.5
  }
  if (source && node.sourceId !== null) {
    fitOperationBoxToImage(node, source)
  }
  return node
}

export class OperationInputError extends Error {
  constructor(
    message: string,
    readonly panel: 'source' | 'prompt' | 'mask' | 'margins' | 'references' | 'enhance',
  ) {
    super(message)
  }
}

function validateOperation(node: CanvasOperation, source?: CanvasAsset) {
  if (
    (!source && (node.sourceId !== null || !isGenerateKind(node.kind))) ||
    source?.kind === 'favorite'
  ) {
    throw new OperationInputError('请选择画布上的一张底图', 'source')
  }
  const { version, params } = node.request
  if (
    (node.kind === 'inpaint' || node.kind === 'outpaint') &&
    version === 'v5' &&
    params.preciseReferences?.length
  ) {
    throw new OperationInputError(V5_INPAINT_REFERENCE_NOTICE, 'references')
  }
  if (!source || isGenerateKind(node.kind)) {
    return
  }
  const { width, height } = source
  if (!width || !height) {
    throw new OperationInputError('无法读取底图尺寸，请重新选择底图', 'source')
  }
  if (node.kind === 'inpaint') {
    if (width * height > 4 * 1024 * 1024 || width % 64 || height % 64) {
      throw new OperationInputError(
        '重绘底图宽高须为 64 的倍数，总像素不能超过 4096×1024',
        'source',
      )
    }
    if (!node.strokes.some((stroke) => stroke.radius > 0 && stroke.points.length)) {
      throw new OperationInputError('请先在底图上涂出重绘区域', 'mask')
    }
    return
  }
  const tool = imageTool(node)
  if (!tool) {
    return
  }
  if (
    tool.kind === 'outpaint' &&
    [tool.left, tool.right, tool.top, tool.bottom].some(
      (value) => !Number.isInteger(value) || value < 0 || value > 2048 || value % 64 !== 0,
    )
  ) {
    throw new OperationInputError('扩展边距须为 0–2048 之间的 64 的倍数', 'margins')
  }
  const reason = toolBlockedReason(tool, { ...params, version, width, height })
  if (reason) {
    if (tool.kind === 'enhance') {
      throw new OperationInputError(reason, 'enhance')
    }
    const panel = tool.kind === 'outpaint' && !(width % 64 || height % 64) ? 'margins' : 'source'
    throw new OperationInputError(reason, panel)
  }
}

function maskRegion(node: CanvasOperation, width: number, height: number): PageRegion {
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
    const temporary = node.saveToGallery === false
    const storage = temporary ? { temporary: true } : {}
    const source = session.images.find((image) => image.id === node.sourceId)?.asset
    validateOperation(node, source)
    const tool = imageTool(node)
    const targetSize = operationSize(node, source)
    if (targetSize && node.kind !== 'upscale') {
      Object.assign(request.params, targetSize)
    }
    let draft = { base: request.base, negative: request.negative, characters: request.characters }
    if (
      node.kind !== 'upscale' &&
      source?.kind === 'gallery' &&
      !draft.base.trim() &&
      !draft.negative.trim() &&
      !draft.characters.length
    ) {
      const recipe = await window.canvasApi.naiRecipe(source.name).catch(() => null)
      if (recipe) {
        const { base, negative, characters } = recipe.request
        draft = { base, negative, characters }
      }
    }
    const params = request.params
    let regions: PageRegion[] = []
    if (node.kind === 'inpaint') {
      regions = [maskRegion(node, params.width, params.height)]
    }
    const usesImg2Img = isGenerateKind(node.kind) && source?.kind === 'gallery'
    let workspace = await window.canvasApi.pagesCreate(
      source?.kind === 'gallery' ? source.name : null,
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
    if (!temporary && request.collectionId) {
      workspace = await window.canvasApi.pagesEdit(workspace.id, workspace.revision, {
        type: 'collection',
        collectionId: request.collectionId,
      })
    }
    const before = new Set(workspace.versions.map((version) => version.id))
    node.lastRun.message = '正在执行'
    if (tool) {
      workspace = await window.canvasApi.pagesImageTool(workspace.id, workspace.revision, {
        ...tool,
        ...storage,
      })
    } else {
      const execution = usesImg2Img
        ? { kind: 'img2img' as const, regionId: null, strength: node.strength, noise: node.noise }
        : {
            kind: node.kind === 'inpaint' ? ('inpaint' as const) : ('generate' as const),
            regionId: regions[0]?.id ?? null,
          }
      workspace = await window.canvasApi.pagesGenerate(workspace.id, workspace.revision, {
        ...execution,
        ...storage,
      })
    }
    node.outputs = allOperationOutputs(session, node)
    for (const version of workspace.versions) {
      const image = version.image
      if (!image || before.has(version.id)) {
        continue
      }
      const label = operationLabel(node.kind) + ' · ' + version.label
      const output = {
        id: crypto.randomUUID(),
        asset: {
          kind: 'gallery' as const,
          name: image.name,
          label,
          width: image.width,
          height: image.height,
          modifiedAt: image.createdAt,
        },
        label,
        workspaceId: workspace.id,
        versionId: version.id,
        createdAt: version.createdAt,
      }
      node.outputs.push(output)
      node.activeOutputId = output.id
      if (node.outputMode === 'branch') {
        ensureOutputBranch(session, node, output)
      } else {
        fitInlineOutput(node, output)
      }
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
