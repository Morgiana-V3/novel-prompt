<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { CanvasAiEdit } from '@shared/canvas-ai'
import { REFERENCE_LABELS } from '@shared/generation/references'
import type { NaiGenRequest } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import { reportError, toast } from '../../shared/lib/notifications'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import CanvasAiDrawer from './CanvasAiDrawer.vue'
import CanvasContextMenu, { type CanvasMenuItem } from './CanvasContextMenu.vue'
import CanvasNodeToolbar, { type SelectedCanvasTarget } from './CanvasNodeToolbar.vue'
import CanvasPortNode from './CanvasPortNode.vue'
import { edgePoint, nearestPort, type PortSide } from './canvas-ports'
import CanvasOperationCard from './CanvasOperationCard.vue'
import CanvasOperationDialog, { type OperationDialogTab } from './CanvasOperationDialog.vue'
import CanvasThumbnail from './CanvasThumbnail.vue'
import CanvasWirePopover, { type ActiveWireEditor } from './CanvasWirePopover.vue'
import { applyCanvasAiEdit, type CanvasAiAppliedTarget } from './canvas-ai-edits'
import {
  DRAG_ASSET_MIME,
  activeCanvasDrag,
  canvasDragPointer,
  clearCanvasDrag,
  writeCanvasDrag,
} from './canvas-drag'
import { freePosition } from './layout'
import {
  CANVAS_PALETTE_TOOLS,
  cardErrors,
  runningCards,
  connectImageToOperation,
  imageAspectRatio,
  isGenerateKind,
  newOperation,
  operationLabel,
  resolvedReferenceName,
  TOOL_ICONS,
  type CanvasWireRole,
} from './operations'
import {
  CANVAS_TOOLS,
  activeOperationOutput,
  allOperationOutputs,
  canvasClipboard,
  extractOutputAsCanvasImage,
  type CanvasClipboardItem,
  type CanvasAsset,
  type CanvasBox,
  type CanvasGalleryAsset,
  type CanvasImage,
  type CanvasOperation,
  type CanvasPoint,
  type CanvasSession,
  type CanvasTool,
} from './session'
import { useCanvasFavorites, type FavoriteMaterial } from './use-canvas-favorites'
import { useCanvasGallery } from './use-canvas-gallery'
import { canvasImageUrl, useCanvasPreviews, type CanvasPreview } from './use-canvas-previews'
import { useCanvasViewport } from './use-canvas-viewport'

interface WorkflowConnection {
  from: CanvasBox
  to: CanvasBox
  id: string
  active: boolean
  tone: 'pink' | 'blue' | 'amber' | 'neutral'
  label?: string
  imageId?: number
  operationId?: number
  role?: CanvasWireRole
}

interface PendingWireDrag {
  pointerId: number
  origin: CanvasImage | CanvasOperation
  side: PortSide
  pointer: CanvasPoint
  target?: CanvasImage | CanvasOperation
  targetSide?: PortSide
}

const props = defineProps<{ session: CanvasSession; title: string }>()
const galleryOpen = defineModel<boolean>('galleryOpen', { default: false })
const emit = defineEmits<{ exit: [] }>()

const dragToolMime = 'application/x-novelprompt-canvas-tool'
const dragFavoriteMime = 'application/x-novelprompt-canvas-favorite'

const imageInput = ref<HTMLInputElement>()
const galleryPanel = ref<HTMLElement>()
const galleryHeading = ref<HTMLElement>()
const toolbarRef = ref<InstanceType<typeof CanvasNodeToolbar>>()
const aiDrawerRef = ref<InstanceType<typeof CanvasAiDrawer>>()
const galleryId = useId()
const galleryTitleId = useId()
const materialSource = ref<'gallery' | 'favorites'>('gallery')

const aiOpen = ref(false)
const dialogNode = ref<CanvasOperation | null>(null)
const dialogTab = ref<OperationDialogTab>('prompt')
const wireDrag = ref<PendingWireDrag | null>(null)
const activeWireEditor = ref<ActiveWireEditor | null>(null)

const browsingGallery = computed(() => galleryOpen.value && materialSource.value === 'gallery')
const browsingFavorites = computed(() => galleryOpen.value && materialSource.value === 'favorites')

const {
  viewport,
  size,
  zoom,
  canvasBackground,
  visibleImages,
  worldPoint,
  getImageBounds,
  gestureType,
  focusViewport,
  setZoom,
  zoomBy,
  zoomAtPointer,
  fitImages,
  selectImage,
  addImage,
  removeSelected: removeSelectedNode,
  beginGesture,
  beginResize,
  trackGesture,
  finishGesture,
  cancelGesture,
} = useCanvasViewport(() => props.session)

const {
  loading,
  error,
  refreshGallery,
  displayedAssets,
  hasMore: galleryHasMore,
  totalCount: galleryTotalCount,
  loadMore: loadMoreGallery,
  collection,
  collectionOptions,
  selectCollection,
} = useCanvasGallery(
  () => props.session,
  () => browsingGallery.value,
)

const {
  loading: loadingFavorites,
  error: favoritesError,
  refreshFavorites,
  displayedFavorites,
  selectedFavorite,
  selectFavorite,
  favoriteUrlFor,
  hasMore: favoritesHasMore,
  totalCount: favoritesTotalCount,
  loadMore: loadMoreFavorites,
} = useCanvasFavorites(
  () => props.session,
  () => browsingFavorites.value,
)

const sourceLoading = computed(() =>
  browsingGallery.value ? loading.value : loadingFavorites.value,
)
const sourceError = computed(() => (browsingGallery.value ? error.value : favoritesError.value))
const sourceHasItems = computed(() =>
  browsingGallery.value ? !!displayedAssets.value.length : !!displayedFavorites.value.length,
)
const sourceHasMore = computed(() =>
  browsingGallery.value ? galleryHasMore.value : favoritesHasMore.value,
)
const sourceCountText = computed(() =>
  browsingGallery.value
    ? `已加载 ${displayedAssets.value.length} / ${galleryTotalCount.value} 张`
    : `已加载 ${displayedFavorites.value.length} / ${favoritesTotalCount.value} 项`,
)

const visibleOperations = computed(() =>
  props.session.operations.flatMap((node) => {
    const bounds = getImageBounds(node)
    return bounds.left + bounds.width >= -120 &&
      bounds.top + bounds.height >= -120 &&
      bounds.left <= size.width + 120 &&
      bounds.top <= size.height + 120
      ? [{ node, bounds }]
      : []
  }),
)

const galleryScrollTop = ref(0)

watch(collection, () => {
  galleryScrollTop.value = 0
})

const visibleGalleryAssets = computed(() => {
  if (!browsingGallery.value) {
    return []
  }
  const startRow = Math.max(0, Math.floor(galleryScrollTop.value / 88) - 4)
  const startIndex = startRow * 3
  return displayedAssets.value.slice(startIndex, startIndex + 96)
})

const { previewFor } = useCanvasPreviews(() => [
  ...(toolbarRef.value?.historyAssets ?? []),
  ...visibleGalleryAssets.value,
])
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)

const canvasCountLabel = computed(() => {
  const imageCount = props.session.images.length
  const operationCount = props.session.operations.length
  if (!operationCount) {
    return `${imageCount} 张图片`
  }
  return `${imageCount} 图 · ${operationCount} 盒`
})

const selectedTarget = computed<SelectedCanvasTarget | null>(() => {
  const selectedId = props.session.selectedId
  if (selectedId === null) {
    return null
  }
  const image = props.session.images.find((item) => item.id === selectedId)
  if (image) {
    return { kind: 'image', image }
  }
  const node = props.session.operations.find((item) => item.id === selectedId)
  if (node) {
    return { kind: 'operation', node }
  }
  return null
})

const selectedBounds = computed(() => {
  const target = selectedTarget.value
  if (!target) {
    return null
  }
  return getImageBounds(target.kind === 'image' ? target.image : target.node)
})

const activeWireImage = computed(() =>
  activeWireEditor.value
    ? (props.session.images.find((image) => image.id === activeWireEditor.value?.imageId) ?? null)
    : null,
)

const activeWireNode = computed(() =>
  activeWireEditor.value
    ? (props.session.operations.find((node) => node.id === activeWireEditor.value?.operationId) ??
      null)
    : null,
)

const pointerPosition = ref<CanvasPoint>()
const visiblePorts = computed(() => [
  ...visibleImages.value.map(({ image, bounds }) => ({ id: image.id, box: image, bounds })),
  ...visibleOperations.value.map(({ node, bounds }) => ({ id: node.id, box: node, bounds })),
])
const eligiblePorts = computed(() => {
  const origin = wireDrag.value?.origin
  if (!origin) {
    return visiblePorts.value
  }
  const fromImage = 'asset' in origin
  return visiblePorts.value.filter(({ box }) =>
    fromImage ? 'sourceId' in box && !runningCards.has(box) : 'asset' in box,
  )
})
const magnet = computed(() =>
  !wireDrag.value && pointerPosition.value && !gestureType.value
    ? nearestPort(pointerPosition.value, visiblePorts.value)
    : undefined,
)

function facingSide(from: CanvasBox, to: CanvasBox): PortSide {
  return to.x + to.width / 2 >= from.x + from.width / 2 ? 'right' : 'left'
}

function buildCurve(
  start: CanvasPoint,
  startSide: PortSide,
  end: CanvasPoint,
  endSide: PortSide,
  bow = 0,
) {
  const { x: startX, y: startY } = start
  const { x: endX, y: endY } = end
  const dx = Math.abs(endX - startX)
  const dy = Math.abs(endY - startY)
  const controlOffset = Math.max(48, Math.min(168, dx * 0.45 + dy * 0.14))
  const c1x = startSide === 'right' ? startX + controlOffset : startX - controlOffset
  const c2x = endSide === 'left' ? endX - controlOffset : endX + controlOffset
  const path = `M ${startX} ${startY} C ${c1x} ${startY + bow}, ${c2x} ${endY + bow}, ${endX} ${endY}`
  return {
    path,
    midX: (startX + 3 * c1x + 3 * c2x + endX) / 8,
    midY: (startY + endY) / 2 + 0.75 * bow,
  }
}

function connectBoxes(fromBox: CanvasBox, toBox: CanvasBox, bow = 0) {
  const side = facingSide(fromBox, toBox)
  const endSide = side === 'left' ? 'right' : 'left'
  const fromBounds = getImageBounds(fromBox)
  const toBounds = getImageBounds(toBox)
  return buildCurve(edgePoint(fromBounds, side), side, edgePoint(toBounds, endSide), endSide, bow)
}

const workflowConnections = computed(() => {
  const imagesById = new Map(props.session.images.map((image) => [image.id, image]))
  const imageByGalleryName = new Map<string, CanvasImage>()
  for (const image of props.session.images) {
    if (image.asset.kind === 'gallery') {
      if (!imageByGalleryName.has(image.asset.name)) {
        imageByGalleryName.set(image.asset.name, image)
      }
      const alias = resolvedReferenceName(image.asset.name)
      if (!imageByGalleryName.has(alias)) {
        imageByGalleryName.set(alias, image)
      }
    }
  }
  const opsById = new Map(props.session.operations.map((node) => [node.id, node]))
  const selectedId = props.session.selectedId
  const pairs = new Map<string, WorkflowConnection[]>()
  function addConnection(
    node: CanvasOperation,
    image: CanvasImage,
    output: boolean,
    edge: Pick<WorkflowConnection, 'id' | 'tone' | 'label' | 'role'>,
  ) {
    const key = `${node.id}:${image.id}`
    const pair = pairs.get(key) ?? []
    pair.push({
      ...edge,
      from: output ? node : image,
      to: output ? image : node,
      imageId: image.id,
      operationId: node.id,
      active: selectedId === image.id || selectedId === node.id,
    })
    pairs.set(key, pair)
  }

  for (const node of props.session.operations) {
    if (node.sourceId !== null) {
      const source = imagesById.get(node.sourceId)
      if (source) {
        const isImg2Img = isGenerateKind(node.kind)
        const role: CanvasWireRole = isImg2Img ? 'img2img' : 'source'
        addConnection(node, source, false, {
          id: `src-${source.id}-${node.id}`,
          tone: isImg2Img ? 'pink' : 'neutral',
          label: isImg2Img ? `图生图 · ${node.strength.toFixed(2)}` : '底图',
          role,
        })
      }
    }

    const preciseList = node.request.params.preciseReferences ?? []
    preciseList.forEach((entry, index) => {
      const source = imageByGalleryName.get(entry.imageName)
      if (!source) {
        return
      }
      addConnection(node, source, false, {
        id: `prec-${source.id}-${node.id}-${index}`,
        tone: 'blue',
        label: `精确参考 · ${REFERENCE_LABELS[entry.mode]}`,
        role: 'precise',
      })
    })

    const vibeList = node.request.params.vibeReferences ?? []
    vibeList.forEach((entry, index) => {
      const source = imageByGalleryName.get(entry.imageName)
      if (!source) {
        return
      }
      addConnection(node, source, false, {
        id: `vibe-${source.id}-${node.id}-${index}`,
        tone: 'amber',
        label: `Vibe · ${entry.strength.toFixed(2)}`,
        role: 'vibe',
      })
    })
  }

  for (const image of props.session.images) {
    if (image.operationId === undefined) {
      continue
    }
    const producer = opsById.get(image.operationId)
    if (!producer) {
      continue
    }
    addConnection(producer, image, true, {
      id: `res-${producer.id}-${image.id}`,
      tone: 'neutral',
    })
  }

  return Array.from(pairs.values()).flatMap((pair) =>
    pair.map((edge, index) => ({ ...edge, bow: (index - (pair.length - 1) / 2) * 56 })),
  )
})

const workflowEdges = computed(() => {
  if (wireDrag.value) {
    return []
  }
  return workflowConnections.value.map((edge) => ({
    ...edge,
    ...connectBoxes(edge.from, edge.to, edge.bow),
  }))
})

function resizeOperation(event: PointerEvent, node: CanvasOperation) {
  const source = props.session.images.find((image) => image.id === node.sourceId)
  const hasInlineOutput =
    node.outputMode !== 'branch' && allOperationOutputs(props.session, node).length > 0
  const ratio =
    source && !hasInlineOutput ? imageAspectRatio(source, node) : node.width / node.height
  beginResize(event, node, ratio, 180, 760)
}

const wirePreviewPath = computed(() => {
  const drag = wireDrag.value
  if (!drag) {
    return ''
  }
  const bounds = getImageBounds(drag.origin)
  const start = edgePoint(bounds, drag.side)
  if (drag.target && drag.targetSide) {
    const end = edgePoint(getImageBounds(drag.target), drag.targetSide)
    return buildCurve(start, drag.side, end, drag.targetSide).path
  }
  const freeSide = drag.pointer.x >= start.x ? 'left' : 'right'
  return buildCurve(start, drag.side, drag.pointer, freeSide).path
})

function localViewportPoint(clientX: number, clientY: number): CanvasPoint {
  const rect = viewport.value?.getBoundingClientRect()
  return {
    x: clientX - (rect?.left ?? 0),
    y: clientY - (rect?.top ?? 0),
  }
}

function trackCanvasPointer(event: PointerEvent) {
  trackGesture(event)
  if (!wireDrag.value) {
    pointerPosition.value = gestureType.value
      ? undefined
      : localViewportPoint(event.clientX, event.clientY)
  }
}

function handleWirePointerMove(event: PointerEvent) {
  const drag = wireDrag.value
  if (!drag || event.pointerId !== drag.pointerId) {
    return
  }
  drag.pointer = localViewportPoint(event.clientX, event.clientY)
  const element = document.elementFromPoint(event.clientX, event.clientY)
  pointerPosition.value = viewport.value?.contains(element) ? drag.pointer : undefined
  const owner = element?.closest<HTMLElement>('[data-port-node]')
  drag.target = eligiblePorts.value.find(
    (entry) => entry.id === Number(owner?.dataset.portNode),
  )?.box
  drag.targetSide = drag.target ? facingSide(drag.target, drag.origin) : undefined
}

function finishWireDrag(event: PointerEvent) {
  const drag = wireDrag.value
  if (!drag || event.pointerId !== drag.pointerId) {
    return
  }
  handleWirePointerMove(event)
  stopWireListeners()
  const target = drag.target
  wireDrag.value = null
  if (!target) {
    return
  }
  const node = 'sourceId' in target ? target : drag.origin
  const image = 'asset' in target ? target : drag.origin
  if (!('sourceId' in node) || !('asset' in image) || runningCards.has(node)) {
    return
  }
  let role: CanvasWireRole = 'source'
  if (isGenerateKind(node.kind)) {
    const alreadyHasOtherBase = node.sourceId !== null && node.sourceId !== image.id
    role = alreadyHasOtherBase ? 'precise' : 'img2img'
  }
  if (node.sourceId !== image.id || role === 'precise') {
    connectImageToOperation(node, image, role)
  }
  selectImage(node)
  const midpoint = connectBoxes(image, node)
  activeWireEditor.value = {
    imageId: image.id,
    operationId: node.id,
    role,
    x: midpoint.midX,
    y: midpoint.midY,
  }
}

function cancelWireDrag() {
  if (!wireDrag.value) {
    return false
  }
  stopWireListeners()
  wireDrag.value = null
  return true
}

function stopWireListeners() {
  window.removeEventListener('pointermove', handleWirePointerMove)
  window.removeEventListener('pointerup', finishWireDrag)
  window.removeEventListener('pointercancel', cancelWireDrag)
  window.removeEventListener('blur', cancelWireDrag)
}

function startWire(
  origin: CanvasImage | CanvasOperation,
  event: PointerEvent,
  side: PortSide = 'right',
) {
  if (event.button !== 0 || wireDrag.value || ('sourceId' in origin && runningCards.has(origin))) {
    return
  }
  activeWireEditor.value = null
  focusViewport()
  wireDrag.value = {
    pointerId: event.pointerId,
    origin,
    side,
    pointer: localViewportPoint(event.clientX, event.clientY),
  }
  window.addEventListener('pointermove', handleWirePointerMove)
  window.addEventListener('pointerup', finishWireDrag)
  window.addEventListener('pointercancel', cancelWireDrag)
  window.addEventListener('blur', cancelWireDrag)
}

function openWireEditor(edge: WorkflowConnection & { midX: number; midY: number }) {
  if (!edge.imageId || !edge.operationId || !edge.role) {
    return
  }
  activeWireEditor.value = {
    imageId: edge.imageId,
    operationId: edge.operationId,
    role: edge.role,
    x: edge.midX,
    y: edge.midY,
  }
}

function placeOperation(
  kind: CanvasTool,
  event?: MouseEvent,
  recipe?: NaiGenRequest,
  placement?: { point?: CanvasPoint; source?: CanvasImage },
) {
  const session = props.session
  const source = placement
    ? placement.source
    : session.images.find((image) => image.id === session.selectedId)
  const node = newOperation(kind, session.nextImageId++, source)
  if (kind === 'generate' && source && !event) {
    connectImageToOperation(node, source, 'img2img')
  }
  const at = placement?.point ?? worldPoint(event)
  node.x = at.x - node.width / 2
  node.y = at.y - node.height / 2
  if (source && !event) {
    node.x = source.x + source.width + 48
    node.y = source.y
  }
  if (recipe) {
    node.request = JSON.parse(JSON.stringify(recipe))
  }
  if (kind === 'inpaint' && source?.asset.width && source.asset.height) {
    Object.assign(node.request.params, { width: source.asset.width, height: source.asset.height })
  }
  if (!event && !placement?.point) {
    node.x = freePosition(session, node)
    const bounds = getImageBounds(node)
    if (
      bounds.left < 84 ||
      bounds.left + bounds.width > unobstructedWidth() - 16 ||
      bounds.top < 54 ||
      bounds.top + bounds.height > size.height - 54
    ) {
      fitImages(unobstructedWidth(), source ? [source, node] : [node])
    }
  }
  session.operations.push(node)
  selectImage(node)
  activeWireEditor.value = null
  galleryOpen.value = false
}

function previewImageDimensions(widthPx?: number, heightPx?: number) {
  const aspectRatio = widthPx && heightPx && widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 1
  const maxSide = 300
  return {
    width: maxSide * Math.min(1, aspectRatio),
    height: maxSide / Math.max(1, aspectRatio),
  }
}

const dragPreview = computed(() => {
  const item = activeCanvasDrag.value
  if (!item) {
    return null
  }
  if (item.kind === 'tool') {
    const node = newOperation(item.tool, 0)
    return { kind: 'operation' as const, node, width: node.width, height: node.height }
  }
  if (item.kind === 'gallery') {
    const { width, height } = previewImageDimensions(item.asset.width, item.asset.height)
    return {
      kind: 'image' as const,
      label: item.asset.label ?? item.asset.name,
      meta: item.asset.width && item.asset.height ? `${item.asset.width}×${item.asset.height}` : '',
      preview: imagePreview(item.asset),
      width,
      height,
    }
  }
  if (item.material.imageUrl || item.material.thumbnail) {
    const { width, height } = previewImageDimensions(
      item.material.asset.width,
      item.material.asset.height,
    )
    return {
      kind: 'image' as const,
      label: item.material.asset.label,
      meta: '',
      preview: favoritePreview(item.material.imageUrl || item.material.thumbnail),
      width,
      height,
    }
  }
  const node = newOperation('generate', 0)
  if (item.material.request) {
    node.request = JSON.parse(JSON.stringify(item.material.request))
  }
  return { kind: 'operation' as const, node, width: node.width, height: node.height }
})

const dragPreviewStyle = computed(() => {
  const preview = dragPreview.value
  const cursor = canvasDragPointer.value
  if (!preview || !cursor) {
    return null
  }
  return {
    left: `${cursor.x - (preview.width * zoom.value) / 2}px`,
    top: `${cursor.y - (preview.height * zoom.value) / 2}px`,
    width: `${preview.width}px`,
    height: `${preview.height}px`,
    transform: `scale(${zoom.value})`,
  }
})

function dragTool(event: DragEvent, kind: CanvasTool) {
  event.dataTransfer?.setData(dragToolMime, kind)
  writeCanvasDrag(event, { kind: 'tool', tool: kind })
}

function dragGalleryAsset(event: DragEvent, asset: CanvasGalleryAsset) {
  if (!event.dataTransfer) {
    return
  }
  event.dataTransfer.setData(DRAG_ASSET_MIME, JSON.stringify(asset))
  writeCanvasDrag(event, { kind: 'gallery', asset })
}

function dragFavoriteMaterial(event: DragEvent, material: FavoriteMaterial) {
  if (!event.dataTransfer) {
    return
  }
  event.dataTransfer.setData(
    dragFavoriteMime,
    JSON.stringify({
      favoriteId: material.asset.favoriteId,
      label: material.asset.label,
      hasThumbnail: Boolean(material.imageUrl),
      request: material.request,
    }),
  )
  writeCanvasDrag(event, { kind: 'favorite', material })
}

async function importFile(file: File, atPoint?: CanvasPoint) {
  if (file.size > 40 * 1024 * 1024) {
    throw new Error('图片不能超过 40 MB')
  }
  const image = await window.canvasApi.imagesImport(
    new Uint8Array(await file.arrayBuffer()),
    DEFAULT_COLLECTION,
  )
  placeImage(
    {
      kind: 'gallery',
      name: image.name,
      width: image.width,
      height: image.height,
      label: file.name,
    },
    atPoint,
  )
}

async function pickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const point = importPoint
  importPoint = undefined
  try {
    for (const [index, file] of files.entries()) {
      const at = point && { x: point.x + index * 24, y: point.y + index * 24 }
      await importFile(file, at)
    }
  } catch (reason) {
    reportError(reason)
  }
}

async function dropOnCanvas(event: DragEvent) {
  const transfer = event.dataTransfer
  clearCanvasDrag()
  if (!transfer) {
    return
  }
  const dropWorld = worldPoint(event)

  const kind = transfer.getData(dragToolMime)
  if (Object.hasOwn(CANVAS_TOOLS, kind)) {
    placeOperation(kind as CanvasTool, event)
    return
  }

  const assetJson = transfer.getData(DRAG_ASSET_MIME)
  if (assetJson) {
    try {
      const asset = JSON.parse(assetJson) as CanvasGalleryAsset
      placeImage(asset, dropWorld)
    } catch (reason) {
      reportError(reason)
    }
    return
  }

  const favoriteJson = transfer.getData(dragFavoriteMime)
  if (favoriteJson) {
    try {
      const payload = JSON.parse(favoriteJson) as {
        favoriteId: string
        label: string
        hasThumbnail: boolean
        request?: NaiGenRequest
      }
      if (payload.hasThumbnail) {
        const asset = await window.canvasApi.favoriteImage(payload.favoriteId)
        placeImage({ ...asset, label: payload.label }, dropWorld)
      } else if (payload.request) {
        placeOperation('generate', event, payload.request)
      }
    } catch (reason) {
      reportError(reason)
    }
    return
  }

  try {
    for (const file of Array.from(transfer.files)) {
      await importFile(file, dropWorld)
    }
  } catch (reason) {
    reportError(reason)
  }
}

function assetTitle(asset: CanvasAsset) {
  return asset.kind === 'favorite' ? asset.label : asset.name
}

function favoritePreview(url?: string): CanvasPreview {
  return url ? { state: 'ready', url } : { state: 'failed' }
}

function imagePreview(asset: CanvasAsset) {
  return asset.kind === 'favorite'
    ? favoritePreview(favoriteUrlFor(asset.favoriteId))
    : { state: 'ready' as const, url: canvasImageUrl(asset) }
}

function operationSourcePreview(node: CanvasOperation) {
  if (node.sourceId === null) {
    return undefined
  }
  const source = props.session.images.find((image) => image.id === node.sourceId)
  return source ? imagePreview(source.asset) : undefined
}

watch(
  galleryOpen,
  (open) => {
    if (open) {
      galleryHeading.value?.focus()
    } else {
      focusViewport()
    }
  },
  { flush: 'post' },
)

function toggleGallery() {
  galleryOpen.value = !galleryOpen.value
}

function onGalleryScroll(event: Event) {
  const container = event.currentTarget as HTMLElement
  if (browsingGallery.value) {
    galleryScrollTop.value = container.scrollTop
  }
  if (container.scrollHeight - container.scrollTop - container.clientHeight < 140) {
    if (browsingGallery.value) {
      loadMoreGallery()
    } else {
      loadMoreFavorites()
    }
  }
}

function refreshMaterials() {
  if (browsingGallery.value) {
    void refreshGallery().catch(reportError)
  } else {
    void refreshFavorites().catch(reportError)
  }
}

async function placeFavorite() {
  const favorite = selectedFavorite.value
  if (!favorite?.imageUrl) {
    return
  }
  try {
    const asset = await window.canvasApi.favoriteImage(favorite.asset.favoriteId)
    placeImage({ ...asset, label: favorite.asset.label })
  } catch (reason) {
    reportError(reason)
  }
}

function unobstructedWidth() {
  const rightInset = aiOpen.value ? 396 : 0
  const available = size.width - rightInset
  return available > 240 ? available : 240
}

function placeImage(asset: CanvasAsset, atPoint?: CanvasPoint) {
  addImage(asset, unobstructedWidth(), atPoint)
  focusViewport()
}

function showResult(id: number) {
  const result = props.session.images.filter((image) => image.operationId === id).at(-1)
  const node = props.session.operations.find((item) => item.id === id)
  if (!result || !node) {
    return
  }
  const source = props.session.images.find((item) => item.id === node.sourceId)
  fitImages(unobstructedWidth(), source ? [source, node, result] : [node, result])
  selectImage(result)
}

function openOperationDialog(node: CanvasOperation, tab: OperationDialogTab) {
  activeWireEditor.value = null
  dialogNode.value = node
  dialogTab.value = tab
}

function bindGallerySource(galleryImage: NaiImage) {
  const card = dialogNode.value
  if (!card || runningCards.has(card)) {
    return
  }
  const session = props.session
  let image = session.images.find(
    (item) => item.asset.kind === 'gallery' && item.asset.name === galleryImage.name,
  )
  if (!image) {
    const { width, height } = previewImageDimensions(galleryImage.width, galleryImage.height)
    const y = card.y + (card.height - height) / 2
    let x = card.x - width - 48
    // 从盒子左侧向外找空位，保留已有节点的位置。
    const row = [...session.operations, ...session.images]
      .filter((item) => item.y < y + height + 24 && item.y + item.height + 24 > y)
      .sort((first, second) => second.x - first.x)
    for (const item of row) {
      if (x < item.x + item.width + 24 && x + width + 24 > item.x) {
        x = item.x - width - 48
      }
    }
    addImage(
      {
        kind: 'gallery',
        name: galleryImage.name,
        width: galleryImage.width,
        height: galleryImage.height,
        modifiedAt: galleryImage.createdAt,
      },
      unobstructedWidth(),
      { x: x + width / 2, y: y + height / 2 },
    )
    image = session.images.at(-1)
    selectImage(card)
  }
  if (image) {
    connectImageToOperation(card, image, 'img2img')
    cardErrors.delete(card)
  }
}

function closeOperationDialog() {
  dialogNode.value = null
  focusViewport()
}

function runDialogOperation() {
  void toolbarRef.value?.runOperation().catch(reportError)
}

async function openSelectedPrimaryTool(node: CanvasOperation) {
  selectImage(node)
  await nextTick()
  toolbarRef.value?.openPrimaryTool()
}

async function openAiDrawer() {
  aiOpen.value = true
  await nextTick()
  aiDrawerRef.value?.focusInput()
}

function closeAiDrawer() {
  aiOpen.value = false
  focusViewport()
}

function focusAiNode(id: number, tab?: OperationDialogTab) {
  const operation = props.session.operations.find((node) => node.id === id)
  const box = operation ?? props.session.images.find((image) => image.id === id)
  if (!box) {
    toast('该节点已从画布移除')
    return
  }
  selectImage(box)
  fitImages(unobstructedWidth(), [box])
  if (tab && operation) {
    openOperationDialog(operation, tab)
  }
}

async function handleAiEdit(edit: CanvasAiEdit, done: (targets: CanvasAiAppliedTarget[]) => void) {
  try {
    const result = await applyCanvasAiEdit(props.session, edit, worldPoint())
    if (result.selectedId !== null) {
      const target = props.session.operations.find((item) => item.id === result.selectedId)
      if (target) {
        selectImage(target)
      }
    }
    if (result.focusBoxes.length) {
      fitImages(unobstructedWidth(), result.focusBoxes)
    }
    if (result.summaries.length) {
      toast(`画布已更新：${result.summaries.slice(0, 2).join(' · ')}`)
    }
    done(result.targets)
  } catch (reason) {
    reportError(reason)
    done([])
  }
}

function handleViewportPointerDown(event: PointerEvent) {
  activeWireEditor.value = null
  beginGesture(event)
}

function recenterImages() {
  fitImages(unobstructedWidth())
}

function resetZoom() {
  setZoom(1)
}

let importPoint: CanvasPoint | undefined

function triggerFileImport(point?: CanvasPoint) {
  importPoint = point
  imageInput.value?.click()
}

const contextMenu = ref<{ screen: CanvasPoint; world: CanvasPoint; serial: number }>()
let menuSerial = 0
function openCanvasMenu(event: MouseEvent) {
  const element = event.target instanceof Element ? event.target : null
  const imageId = Number(element?.closest<HTMLElement>('[data-image-id]')?.dataset.imageId)
  const operationId = Number(
    element?.closest<HTMLElement>('[data-canvas-operation-id]')?.dataset.canvasOperationId,
  )
  const session = props.session
  selectImage(
    session.images.find((image) => image.id === imageId) ??
      session.operations.find((node) => node.id === operationId),
  )
  activeWireEditor.value = null
  toolbarRef.value?.closeTool()
  focusViewport()
  contextMenu.value = {
    screen: { x: event.clientX, y: event.clientY },
    world: worldPoint(event),
    serial: ++menuSerial,
  }
}

function closeCanvasMenu() {
  contextMenu.value = undefined
}

function removeSelected() {
  const session = props.session
  const image = session.images.find((entry) => entry.id === session.selectedId)
  const producer = session.operations.find((node) => node.id === image?.operationId)
  if (producer) {
    producer.outputs = allOperationOutputs(session, producer)
  }
  removeSelectedNode()
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotTarget(target: SelectedCanvasTarget): CanvasClipboardItem {
  if (target.kind === 'image') {
    return { kind: 'image', image: cloneValue(target.image) }
  }
  const source = props.session.images.find((image) => image.id === target.node.sourceId)
  const node = cloneValue({
    ...target.node,
    outputs: [],
    lastRun: undefined,
    activeOutputId: undefined,
  })
  return { kind: 'operation', node, source: source && cloneValue(source) }
}

function placeClipboardItem(item: CanvasClipboardItem, point?: CanvasPoint) {
  const session = props.session
  const copy = cloneValue(item)
  const box = copy.kind === 'operation' ? copy.node : copy.image
  box.id = session.nextImageId++
  if (point) {
    box.x = point.x - box.width / 2
    box.y = point.y - box.height / 2
  } else {
    box.x += box.width + 40
    box.x = freePosition(session, box)
  }
  if (copy.kind === 'image') {
    delete copy.image.operationId
    session.images.push(copy.image)
  } else {
    const source = copy.source
    if (source) {
      const matching = session.images.filter(
        (image) =>
          image.asset.kind === source.asset.kind &&
          assetTitle(image.asset) === assetTitle(source.asset),
      )
      let bound = matching.find((image) => image.id === source.id) ?? matching[0]
      if (!bound) {
        bound = { ...source, id: session.nextImageId++, x: box.x - source.width - 40, y: box.y }
        delete bound.operationId
        session.images.push(bound)
      }
      copy.node.sourceId = bound.id
    } else {
      copy.node.sourceId = null
    }
    session.operations.push(copy.node)
  }
  selectImage(box)
  focusViewport()
}

function selectExtracted(image: CanvasImage) {
  selectImage(image)
  const bounds = getImageBounds(image)
  if (
    bounds.left < 0 ||
    bounds.left + bounds.width > unobstructedWidth() ||
    bounds.top < 50 ||
    bounds.top + bounds.height > size.height
  ) {
    fitImages(unobstructedWidth(), [image])
  }
  focusViewport()
}

async function imageFileAction(action: 'copy' | 'save' | 'reveal', asset: CanvasAsset) {
  const file =
    asset.kind === 'gallery' ? asset : await window.canvasApi.favoriteImage(asset.favoriteId)
  if (action === 'copy') {
    const copied = await window.canvasApi.naiCopyImage(file.name)
    toast(copied ? '图片已复制到系统剪贴板' : '未能复制图片')
  } else if (action === 'save') {
    if (await window.canvasApi.naiSaveAs(file.name)) {
      toast('图片已另存')
    }
  } else {
    await window.canvasApi.naiReveal(file.name)
  }
}

async function createFromRecipe(image: CanvasImage) {
  const recipe =
    image.asset.kind === 'gallery' ? await window.canvasApi.naiRecipe(image.asset.name) : null
  if (!recipe) {
    toast('这张图片没有可载入的生成配方')
    return
  }
  placeOperation('generate', undefined, recipe.request, {
    point: { x: image.x + image.width + 168, y: image.y + 112 },
  })
}

const menuGroups = computed<CanvasMenuItem[][]>(() => {
  const session = props.session
  const target = selectedTarget.value
  const point = contextMenu.value?.world
  const source = target?.kind === 'image' ? target.image : undefined
  const newNodes: CanvasMenuItem = {
    label: source ? '以此图新建' : '新建节点',
    children: CANVAS_PALETTE_TOOLS.map((kind) => ({
      label: source && kind === 'generate' ? '生图（图生图）' : operationLabel(kind),
      run: () => placeOperation(kind, undefined, undefined, source ? { source } : { point }),
    })),
  }
  const paste: CanvasMenuItem = {
    label: '粘贴',
    shortcut: 'Ctrl+V',
    disabled: !canvasClipboard.value,
    run: () => {
      if (canvasClipboard.value) {
        placeClipboardItem(canvasClipboard.value, point ?? worldPoint())
      }
    },
  }
  if (!target) {
    return [
      [newNodes],
      [
        {
          label: '从素材库选择',
          run: () => {
            galleryOpen.value = true
          },
        },
        { label: '本地上传图片', run: () => triggerFileImport(point) },
      ],
      [paste],
      [
        { label: '定位全部元素', run: recenterImages },
        { label: '恢复 100% 缩放', run: resetZoom },
      ],
    ]
  }
  const copy: CanvasMenuItem = {
    label: '复制',
    shortcut: 'Ctrl+C',
    run: () => {
      canvasClipboard.value = snapshotTarget(target)
      toast('已复制到画布剪贴板')
    },
  }
  const duplicate: CanvasMenuItem = {
    label: '创建副本',
    shortcut: 'Ctrl+D',
    run: () => placeClipboardItem(snapshotTarget(target)),
  }
  const remove: CanvasMenuItem = {
    label: '删除',
    shortcut: 'Delete',
    danger: true,
    run: removeSelected,
    disabled: session.operations.some(
      (node) =>
        runningCards.has(node) &&
        (node.id === session.selectedId || node.sourceId === session.selectedId),
    ),
  }
  const fileItem = (
    action: 'copy' | 'save' | 'reveal',
    label: string,
    asset?: CanvasAsset,
  ): CanvasMenuItem => ({
    label,
    shortcut: action === 'copy' ? 'Ctrl+Shift+C' : undefined,
    disabled: !asset,
    run: () => asset && imageFileAction(action, asset),
  })
  if (target.kind === 'image') {
    const image = target.image
    return [
      [copy, duplicate, fileItem('copy', '复制图片到系统剪贴板', image.asset), paste],
      [newNodes, { label: '载入该图提示词新建生图盒', run: () => createFromRecipe(image) }],
      [fileItem('save', '另存为…', image.asset), fileItem('reveal', '在文件夹中显示', image.asset)],
      [remove],
    ]
  }
  const node = target.node
  const history = allOperationOutputs(session, node)
  const output = activeOperationOutput(node, history)
  const base = session.images.find((image) => image.id === node.sourceId)
  const useBase = !!base && (!output || node.outputMode === 'branch')
  const asset = useBase ? base.asset : output?.asset
  const extract: CanvasMenuItem = {
    label: '复制为图片',
    disabled: !asset,
    run: () => {
      let image: CanvasImage | undefined
      if (useBase) {
        image = {
          ...cloneValue(base),
          id: session.nextImageId++,
          x: node.x + node.width + 40,
          y: node.y,
        }
        delete image.operationId
        image.x = freePosition(session, image)
        session.images.push(image)
      } else {
        image = extractOutputAsCanvasImage(session, node, output)
      }
      if (image) {
        canvasClipboard.value = snapshotTarget({ kind: 'image', image })
        selectExtracted(image)
      }
    },
  }
  const actions: CanvasMenuItem[] = [
    {
      label: '立即执行',
      disabled: runningCards.has(node),
      run: () => toolbarRef.value?.runOperation(),
    },
    { label: '编辑提示词与参数', run: () => openOperationDialog(node, 'prompt') },
  ]
  if (history.length) {
    actions.push({
      label: '查看历史版本 (' + history.length + ')',
      run: () => toolbarRef.value?.openHistory(),
    })
  }
  actions.push(fileItem('save', '另存图片…', output?.asset))
  return [
    [copy, duplicate, extract, fileItem('copy', '复制图片到系统剪贴板', asset), paste],
    actions,
    [remove],
  ]
})

function handleCanvasShortcut(event: KeyboardEvent) {
  const element = event.target instanceof Element ? event.target : null
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    dialogNode.value ||
    document.querySelector('dialog[open]') ||
    element?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .ai-drawer, .canvas-gallery',
    )
  ) {
    return
  }
  let shortcut: string
  if ((event.ctrlKey || event.metaKey) && ['c', 'd', 'v'].includes(event.key.toLowerCase())) {
    shortcut = 'Ctrl+' + (event.shiftKey ? 'Shift+' : '') + event.key.toUpperCase()
  } else if (event.key === 'Delete' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    shortcut = 'Delete'
  } else {
    return
  }
  const item = menuGroups.value.flat().find((entry) => entry.shortcut === shortcut)
  if (!item?.run || item.disabled) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) {
    closeCanvasMenu()
    Promise.resolve().then(item.run).catch(reportError)
  }
}

onMounted(() => window.addEventListener('keydown', handleCanvasShortcut, true))
onBeforeUnmount(() => window.removeEventListener('keydown', handleCanvasShortcut, true))

function handleEscape(event: KeyboardEvent) {
  if (activeCanvasDrag.value) {
    event.stopPropagation()
    clearCanvasDrag()
  } else if (cancelWireDrag()) {
    event.stopPropagation()
  } else if (cancelGesture()) {
    event.stopPropagation()
  } else if (activeWireEditor.value) {
    event.stopPropagation()
    activeWireEditor.value = null
  } else if (toolbarRef.value?.closeTool()) {
    event.stopPropagation()
  } else if (aiOpen.value) {
    event.stopPropagation()
    closeAiDrawer()
  } else if (galleryPanel.value?.contains(document.activeElement)) {
    event.stopPropagation()
    toggleGallery()
  } else if (props.session.selectedId !== null) {
    event.stopPropagation()
    selectImage()
  }
}

onBeforeUnmount(() => {
  stopWireListeners()
  clearCanvasDrag()
})
</script>

<template>
  <section
    class="infinite-canvas"
    :class="{ 'has-drawer': galleryOpen, 'has-ai-drawer': aiOpen }"
    aria-label="无限画布"
    @keydown.esc="handleEscape"
  >
    <Transition name="canvas-drawer">
      <aside
        v-if="galleryOpen"
        :id="galleryId"
        ref="galleryPanel"
        class="canvas-gallery"
        :aria-labelledby="galleryTitleId"
      >
        <header class="canvas-gallery-header">
          <h2
            :id="galleryTitleId"
            ref="galleryHeading"
            tabindex="-1"
          >
            素材库
          </h2>
          <div class="canvas-gallery-header-actions">
            <button
              class="icon-btn sm"
              type="button"
              aria-label="导入本机图片"
              title="导入本机图片"
              @click="triggerFileImport()"
            >
              <Icon
                name="upload"
                :size="15"
              />
            </button>
            <button
              class="icon-btn sm"
              type="button"
              aria-label="关闭素材库"
              title="关闭素材库"
              @click="toggleGallery"
            >
              <Icon
                name="x"
                :size="15"
              />
            </button>
          </div>
        </header>

        <div class="canvas-gallery-toolbar">
          <div
            v-seg-indicator
            class="seg block canvas-material-sources"
            role="group"
            aria-label="素材来源"
          >
            <button
              class="canvas-source"
              :class="{ on: materialSource === 'gallery' }"
              type="button"
              :aria-pressed="materialSource === 'gallery'"
              @click="materialSource = 'gallery'"
            >
              图集
            </button>
            <button
              class="canvas-source"
              :class="{ on: materialSource === 'favorites' }"
              type="button"
              :aria-pressed="materialSource === 'favorites'"
              @click="materialSource = 'favorites'"
            >
              收藏方案
            </button>
          </div>
          <ThemeSelect
            v-if="browsingGallery"
            :model-value="collection"
            :options="collectionOptions"
            aria-label="选择图集"
            compact
            @update:model-value="selectCollection"
          />
        </div>

        <div
          class="canvas-gallery-body"
          @scroll="onGalleryScroll"
        >
          <div
            v-if="sourceError"
            class="canvas-gallery-message canvas-gallery-error"
            role="alert"
          >
            <p>{{ sourceError }}</p>
            <button
              class="btn small"
              type="button"
              @click="refreshMaterials"
            >
              重试
            </button>
          </div>
          <p
            v-else-if="sourceLoading && !sourceHasItems"
            class="canvas-gallery-message"
            role="status"
          >
            正在读取素材…
          </p>
          <p
            v-else-if="!sourceHasItems"
            class="canvas-gallery-message"
          >
            {{ browsingGallery ? '这个图集还没有图片' : '还没有收藏方案' }}
          </p>
          <template v-else-if="browsingGallery">
            <div class="canvas-gallery-grid">
              <button
                v-for="(asset, index) in displayedAssets"
                :key="asset.name"
                type="button"
                class="canvas-gallery-image"
                draggable="true"
                :aria-label="`点击或拖入第 ${index + 1} 张图片到画布`"
                :title="asset.name + '（点击或拖入画布）'"
                :disabled="previewFor(asset)?.state === 'failed'"
                @dragstart="dragGalleryAsset($event, asset)"
                @click="placeImage(asset)"
              >
                <CanvasThumbnail :preview="previewFor(asset)" />
                <span class="canvas-gallery-add">
                  <Icon
                    name="plus"
                    :size="14"
                  />
                </span>
              </button>
            </div>
            <p class="canvas-gallery-scroll-hint">
              {{ sourceHasMore ? `${sourceCountText} · 向下滚动加载更多` : sourceCountText }}
            </p>
          </template>
          <template v-else>
            <div class="canvas-favorite-list">
              <button
                v-for="material in displayedFavorites"
                :key="material.asset.favoriteId"
                class="canvas-favorite"
                type="button"
                draggable="true"
                :title="material.asset.label + '（可拖入画布）'"
                :aria-pressed="selectedFavorite?.asset.favoriteId === material.asset.favoriteId"
                @dragstart="dragFavoriteMaterial($event, material)"
                @click="selectFavorite(material.asset.favoriteId)"
              >
                <span class="canvas-favorite-preview">
                  <CanvasThumbnail
                    v-if="material.thumbnail"
                    :preview="favoritePreview(material.thumbnail)"
                  />
                  <Icon
                    v-else
                    name="file"
                    :size="16"
                  />
                </span>
                <span class="canvas-favorite-name">{{ material.asset.label }}</span>
              </button>
            </div>
            <p class="canvas-gallery-scroll-hint">
              {{ sourceHasMore ? `${sourceCountText} · 向下滚动加载更多` : sourceCountText }}
            </p>
            <section
              v-if="selectedFavorite"
              class="canvas-favorite-detail"
              aria-label="收藏方案详情"
            >
              <h3>主提示词</h3>
              <p class="canvas-favorite-prompt">
                {{ selectedFavorite.prompt || '这个方案的主提示词为空' }}
              </p>
              <div class="canvas-favorite-actions">
                <button
                  v-if="selectedFavorite.request"
                  class="btn small accent"
                  type="button"
                  @click="placeOperation('generate', undefined, selectedFavorite.request)"
                >
                  <Icon
                    name="generate"
                    :size="14"
                  />
                  创建生图盒
                </button>
                <button
                  v-if="selectedFavorite.imageUrl"
                  class="btn small"
                  type="button"
                  @click="placeFavorite"
                >
                  <Icon
                    name="plus"
                    :size="14"
                  />
                  放入画布
                </button>
              </div>
              <p
                v-if="!selectedFavorite.imageUrl"
                class="canvas-favorite-note"
              >
                此收藏没有可用的图片预览。
              </p>
            </section>
          </template>
        </div>
      </aside>
    </Transition>

    <div class="canvas-surface">
      <div
        ref="viewport"
        class="canvas-viewport"
        :class="{
          'is-panning': gestureType === 'pan',
          'is-moving': gestureType === 'move',
          'is-wiring': Boolean(wireDrag),
        }"
        :style="canvasBackground"
        tabindex="0"
        aria-label="画布视口"
        @contextmenu.prevent="openCanvasMenu"
        @dragover.prevent
        @drop.prevent="dropOnCanvas"
        @pointerdown="handleViewportPointerDown"
        @pointermove="trackCanvasPointer"
        @pointerleave="pointerPosition = undefined"
        @pointerup="finishGesture"
        @pointercancel="cancelGesture"
        @lostpointercapture="cancelGesture"
        @wheel.prevent="zoomAtPointer"
        @keydown.delete.self.stop.prevent="removeSelected"
        @keydown.backspace.self.stop.prevent="removeSelected"
      >
        <svg
          v-if="workflowEdges.length || wirePreviewPath"
          class="canvas-relations"
          aria-hidden="true"
        >
          <path
            v-for="edge in workflowEdges"
            :key="edge.id"
            class="canvas-relation-path"
            :class="['tone-' + edge.tone, { active: edge.active }]"
            :d="edge.path"
          />
          <path
            v-if="wirePreviewPath"
            class="canvas-relation-path is-preview"
            :d="wirePreviewPath"
          />
        </svg>

        <button
          v-for="edge in workflowEdges.filter((item) => item.label)"
          :key="'lbl-' + edge.id"
          class="canvas-wire-pill"
          :class="['tone-' + edge.tone, { active: edge.active }]"
          type="button"
          :style="{ left: `${edge.midX}px`, top: `${edge.midY}px` }"
          title="点击调整连线用途与参数"
          @pointerdown.stop
          @click.stop="openWireEditor(edge)"
        >
          {{ edge.label }}
        </button>

        <CanvasPortNode
          v-for="{ image, bounds } in visibleImages"
          :key="image.id"
          class="canvas-image-wrap"
          :data-image-id="image.id"
          :data-port-node="image.id"
          :bounds="bounds"
          :selected="image.id === session.selectedId"
          :wiring="Boolean(wireDrag)"
          :pull="magnet?.id === image.id ? magnet : undefined"
          :label="`画布图片 ${image.id}`"
          @wire="(event, side) => startWire(image, event, side)"
        >
          <button
            class="canvas-image"
            :class="{ 'wire-hovered': wireDrag?.target?.id === image.id }"
            type="button"
            :data-canvas-image-id="image.id"
            :aria-label="`画布图片 ${image.id}`"
            :aria-pressed="image.id === session.selectedId"
            @pointerdown.stop="beginGesture($event, image)"
            @focus="selectImage(image)"
            @click="selectImage(image)"
          >
            <span
              v-if="bounds.width >= 65"
              class="canvas-image-label"
              :title="assetTitle(image.asset)"
            >
              <Icon
                name="image"
                :size="12"
              />
              <span class="canvas-image-name">{{ image.asset.label ?? `图片 ${image.id}` }}</span>
              <span
                v-if="image.asset.width && image.asset.height && bounds.width >= 160"
                class="canvas-image-meta"
              >
                {{ image.asset.width }}×{{ image.asset.height }}
              </span>
            </span>
            <span class="canvas-image-frame">
              <CanvasThumbnail
                :preview="imagePreview(image.asset)"
                show-error
              />
            </span>
          </button>
          <button
            class="canvas-resize-handle"
            type="button"
            aria-label="缩放图片"
            @pointerdown.stop="beginResize($event, image, imageAspectRatio(image))"
          />
        </CanvasPortNode>

        <CanvasPortNode
          v-for="{ node, bounds } in visibleOperations"
          :key="'op-' + node.id"
          :data-port-node="node.id"
          :bounds="bounds"
          :selected="node.id === session.selectedId"
          :wiring="Boolean(wireDrag)"
          :pull="magnet?.id === node.id ? magnet : undefined"
          :label="`操作盒 ${node.id}`"
          @wire="(event, side) => startWire(node, event, side)"
        >
          <CanvasOperationCard
            :node="node"
            :session="session"
            :source-preview="operationSourcePreview(node)"
            :image-preview="imagePreview"
            :selected="node.id === session.selectedId"
            :wire-hovered="wireDrag?.target?.id === node.id"
            :style="{
              width: node.width + 'px',
              height: node.height + 'px',
              transform: 'scale(' + zoom + ')',
            }"
            @drag="beginGesture($event, node)"
            @resize="resizeOperation($event, node)"
            @select="selectImage(node)"
            @open-primary="openSelectedPrimaryTool(node)"
          />
        </CanvasPortNode>
      </div>

      <div class="canvas-node-overlay">
        <Transition name="canvas-toolbar">
          <CanvasNodeToolbar
            v-if="
              selectedTarget && selectedBounds && !gestureType && !wireDrag && !activeWireEditor
            "
            ref="toolbarRef"
            :target="selectedTarget"
            :anchor="selectedBounds"
            :viewport-size="size"
            :session="session"
            :title="title"
            :history-preview="previewFor"
            :image-preview="imagePreview"
            @remove="removeSelected"
            @spawn-operation="placeOperation"
            @start-wire="startWire"
            @open-dialog="openOperationDialog"
            @show-result="showResult"
            @extracted="selectExtracted"
            @dismiss="selectImage()"
          />
        </Transition>

        <CanvasWirePopover
          v-if="activeWireEditor && activeWireImage && activeWireNode"
          :editor="activeWireEditor"
          :image="activeWireImage"
          :node="activeWireNode"
          :viewport-width="size.width"
          :viewport-height="size.height"
          @update:role="activeWireEditor.role = $event"
          @close="activeWireEditor = null"
        />
      </div>

      <nav
        class="canvas-tools"
        aria-label="画布工具"
      >
        <button
          v-for="kind in CANVAS_PALETTE_TOOLS"
          :key="kind"
          class="canvas-tool-btn"
          type="button"
          draggable="true"
          :aria-label="'拖入或点击添加' + operationLabel(kind)"
          @dragstart="dragTool($event, kind)"
          @click="placeOperation(kind)"
        >
          <Icon
            :name="TOOL_ICONS[kind]"
            :size="18"
          />
          <span
            class="canvas-tool-tip"
            aria-hidden="true"
          >
            {{ operationLabel(kind) }}
          </span>
        </button>
        <hr />
        <button
          class="canvas-tool-btn"
          :class="{ active: galleryOpen }"
          type="button"
          aria-label="素材库"
          :aria-pressed="galleryOpen"
          @click="toggleGallery"
        >
          <Icon
            name="album"
            :size="18"
          />
          <span
            class="canvas-tool-tip"
            aria-hidden="true"
          >
            素材库
          </span>
        </button>
        <button
          class="canvas-tool-btn"
          type="button"
          aria-label="导入本机图片"
          @click="triggerFileImport()"
        >
          <Icon
            name="upload"
            :size="18"
          />
          <span
            class="canvas-tool-tip"
            aria-hidden="true"
          >
            导入图片
          </span>
        </button>
      </nav>

      <input
        ref="imageInput"
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp"
        @change="pickFiles"
      />

      <div
        class="canvas-zoom"
        role="group"
        aria-label="画布视口控制"
      >
        <button
          class="canvas-zoom-step"
          type="button"
          aria-label="缩小"
          title="缩小"
          @click="zoomBy(1 / 1.25)"
        >
          <Icon
            name="minus"
            :size="15"
          />
        </button>
        <button
          class="canvas-zoom-value"
          type="button"
          aria-label="恢复 100% 缩放"
          title="恢复 100% 缩放"
          @click="resetZoom"
        >
          {{ zoomPercent }}
        </button>
        <button
          class="canvas-zoom-step"
          type="button"
          aria-label="放大"
          title="放大"
          @click="zoomBy(1.25)"
        >
          <Icon
            name="plus"
            :size="15"
          />
        </button>
        <span
          class="canvas-dock-divider"
          aria-hidden="true"
        />
        <button
          class="canvas-fit"
          type="button"
          aria-label="定位所有元素"
          title="定位所有元素"
          @click="recenterImages"
        >
          <Icon
            name="frame"
            :size="16"
          />
        </button>
        <span
          class="canvas-dock-divider"
          aria-hidden="true"
        />
        <span
          class="canvas-count"
          aria-live="polite"
        >
          {{ canvasCountLabel }}
        </span>
      </div>

      <button
        v-if="!aiOpen"
        class="canvas-ai-launcher"
        type="button"
        @click="openAiDrawer"
      >
        <Icon
          name="sparkle"
          :size="16"
        />
        <span>与 AI 对话</span>
      </button>
    </div>

    <Transition name="canvas-ai-drawer">
      <CanvasAiDrawer
        v-if="aiOpen"
        ref="aiDrawerRef"
        :session="session"
        :title="title"
        :image-preview="imagePreview"
        @close="closeAiDrawer"
        @focus-classic="emit('exit')"
        @apply-edit="handleAiEdit"
        @focus-node="focusAiNode"
        @open-node="focusAiNode"
      />
    </Transition>

    <CanvasContextMenu
      v-if="contextMenu"
      :key="contextMenu.serial"
      :at="contextMenu.screen"
      :groups="menuGroups"
      @close="closeCanvasMenu"
    />

    <CanvasOperationDialog
      :node="dialogNode"
      :initial-tab="dialogTab"
      :session="session"
      @close="closeOperationDialog"
      @run="runDialogOperation"
      @bind-gallery="bindGallerySource"
    />

    <Teleport to="body">
      <div
        v-if="dragPreview && dragPreviewStyle"
        class="canvas-drag-card"
        :style="dragPreviewStyle"
        aria-hidden="true"
        inert
      >
        <CanvasOperationCard
          v-if="dragPreview.kind === 'operation'"
          :node="dragPreview.node"
          :session="session"
          :selected="false"
          preview
          :style="{
            width: `${dragPreview.width}px`,
            height: `${dragPreview.height}px`,
          }"
        />
        <div
          v-else
          class="canvas-drag-image"
        >
          <span class="canvas-drag-image-label">
            <Icon
              name="image"
              :size="12"
            />
            <span class="canvas-drag-image-name">{{ dragPreview.label }}</span>
            <span
              v-if="dragPreview.meta"
              class="canvas-drag-image-meta"
            >
              {{ dragPreview.meta }}
            </span>
          </span>
          <span class="canvas-drag-image-frame">
            <CanvasThumbnail :preview="dragPreview.preview" />
          </span>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped src="./canvas.css"></style>
