<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { CanvasAiEdit } from '@shared/canvas-ai'
import { REFERENCE_LABELS } from '@shared/generation/references'
import type { NaiGenRequest } from '@shared/generation/types'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import { reportError, toast } from '../../shared/lib/notifications'
import { vSegIndicator } from '../../shared/lib/seg-indicator'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import CanvasAiDrawer from './CanvasAiDrawer.vue'
import CanvasNodeToolbar, { type SelectedCanvasTarget } from './CanvasNodeToolbar.vue'
import CanvasOperationCard from './CanvasOperationCard.vue'
import CanvasOperationDialog, { type OperationDialogTab } from './CanvasOperationDialog.vue'
import CanvasThumbnail from './CanvasThumbnail.vue'
import CanvasWirePopover, { type ActiveWireEditor } from './CanvasWirePopover.vue'
import { applyCanvasAiEdit } from './canvas-ai-edits'
import {
  activeCanvasDrag,
  canvasDragPointer,
  clearCanvasDrag,
  writeCanvasDrag,
} from './canvas-drag'
import { freePosition } from './layout'
import {
  CANVAS_PALETTE_TOOLS,
  connectImageToOperation,
  isGenerateKind,
  newOperation,
  operationLabel,
  resolvedReferenceName,
  TOOL_ICONS,
  type CanvasWireRole,
} from './operations'
import {
  CANVAS_TOOLS,
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
import { useCanvasPreviews, type CanvasPreview } from './use-canvas-previews'
import { useCanvasViewport } from './use-canvas-viewport'

interface WorkflowEdge {
  id: string
  path: string
  midX: number
  midY: number
  active: boolean
  tone: 'pink' | 'blue' | 'amber' | 'neutral'
  label?: string
  imageId?: number
  operationId?: number
  role?: CanvasWireRole
}

interface PendingWireDrag {
  pointerId: number
  image: CanvasImage
  pointer: CanvasPoint
  hoveredOperationId: number | null
}

const props = defineProps<{ session: CanvasSession; title: string }>()
const galleryOpen = defineModel<boolean>('galleryOpen', { default: false })
const emit = defineEmits<{ exit: [] }>()

const dragToolMime = 'application/x-novelprompt-canvas-tool'
const dragAssetMime = 'application/x-novelprompt-canvas-asset'
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
  removeSelected,
  beginGesture,
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
  thumbnailFor,
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

const demandedAssets = computed(() => {
  const imageById = new Map(props.session.images.map((image) => [image.id, image]))
  const selected = visibleImages.value.find(({ image }) => image.id === props.session.selectedId)
  const operationSources = visibleOperations.value.flatMap(({ node }) => {
    const source = node.sourceId ? imageById.get(node.sourceId) : undefined
    return source ? [source.asset] : []
  })
  return [
    ...(selected ? [selected.image.asset] : []),
    ...operationSources,
    ...visibleImages.value.map(({ image }) => image.asset),
    ...visibleGalleryAssets.value,
  ].filter((asset) => asset.kind === 'gallery')
})

const { previewFor } = useCanvasPreviews(() => demandedAssets.value)
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

function buildCurve(startX: number, startY: number, endX: number, endY: number) {
  const forward = endX >= startX
  const controlOffset = Math.max(44, Math.min(148, Math.abs(endX - startX) * 0.45))
  const c1x = forward ? startX + controlOffset : startX - controlOffset
  const c2x = forward ? endX - controlOffset : endX + controlOffset
  const path = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`
  return { path, midX: (startX + endX) / 2, midY: (startY + endY) / 2 }
}

function connectBoxes(fromBox: CanvasBox, toBox: CanvasBox, yOffset = 0) {
  const from = getImageBounds(fromBox)
  const to = getImageBounds(toBox)
  const forward = to.left + to.width / 2 >= from.left + from.width / 2
  const startX = forward ? from.left + from.width : from.left
  const startY = from.top + from.height / 2 + yOffset
  const endX = forward ? to.left : to.left + to.width
  const endY = to.top + to.height / 2 + yOffset
  return buildCurve(startX, startY, endX, endY)
}

const workflowEdges = computed<WorkflowEdge[]>(() => {
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
  const edges: WorkflowEdge[] = []

  for (const node of props.session.operations) {
    if (node.sourceId !== null) {
      const source = imagesById.get(node.sourceId)
      if (source) {
        const isImg2Img = isGenerateKind(node.kind)
        const role: CanvasWireRole = isImg2Img ? 'img2img' : 'source'
        const curve = connectBoxes(source, node)
        edges.push({
          id: `src-${source.id}-${node.id}`,
          ...curve,
          active: selectedId === source.id || selectedId === node.id,
          tone: isImg2Img ? 'pink' : 'neutral',
          label: isImg2Img ? `图生图 · ${node.strength.toFixed(2)}` : '底图',
          imageId: source.id,
          operationId: node.id,
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
      const offset = node.sourceId === source.id ? 22 + index * 14 : index * 14
      const curve = connectBoxes(source, node, offset)
      edges.push({
        id: `prec-${source.id}-${node.id}-${index}`,
        ...curve,
        active: selectedId === source.id || selectedId === node.id,
        tone: 'blue',
        label: `精确参考 · ${REFERENCE_LABELS[entry.mode]}`,
        imageId: source.id,
        operationId: node.id,
        role: 'precise',
      })
    })

    const vibeList = node.request.params.vibeReferences ?? []
    vibeList.forEach((entry, index) => {
      const source = imageByGalleryName.get(entry.imageName)
      if (!source) {
        return
      }
      const offset = node.sourceId === source.id ? -22 - index * 14 : index * 14
      const curve = connectBoxes(source, node, offset)
      edges.push({
        id: `vibe-${source.id}-${node.id}-${index}`,
        ...curve,
        active: selectedId === source.id || selectedId === node.id,
        tone: 'amber',
        label: `Vibe · ${entry.strength.toFixed(2)}`,
        imageId: source.id,
        operationId: node.id,
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
    const curve = connectBoxes(producer, image)
    edges.push({
      id: `res-${producer.id}-${image.id}`,
      ...curve,
      active: selectedId === producer.id || selectedId === image.id,
      tone: 'neutral',
    })
  }

  return edges
})

const wirePreviewPath = computed(() => {
  const drag = wireDrag.value
  if (!drag) {
    return ''
  }
  const from = getImageBounds(drag.image)
  return buildCurve(
    from.left + from.width,
    from.top + from.height / 2,
    drag.pointer.x,
    drag.pointer.y,
  ).path
})

function localViewportPoint(clientX: number, clientY: number): CanvasPoint {
  const rect = viewport.value?.getBoundingClientRect()
  return {
    x: clientX - (rect?.left ?? 0),
    y: clientY - (rect?.top ?? 0),
  }
}

function findOperationAtClient(clientX: number, clientY: number): CanvasOperation | null {
  const element = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-canvas-operation-id]')
  if (!element) {
    return null
  }
  const id = Number(element.dataset.canvasOperationId)
  return props.session.operations.find((node) => node.id === id) ?? null
}

function handleWirePointerMove(event: PointerEvent) {
  const drag = wireDrag.value
  if (!drag || event.pointerId !== drag.pointerId) {
    return
  }
  drag.pointer = localViewportPoint(event.clientX, event.clientY)
  drag.hoveredOperationId = findOperationAtClient(event.clientX, event.clientY)?.id ?? null
}

function finishWireDrag(event: PointerEvent) {
  const drag = wireDrag.value
  if (!drag || event.pointerId !== drag.pointerId) {
    return
  }
  stopWireListeners()
  const target = findOperationAtClient(event.clientX, event.clientY)
  wireDrag.value = null
  if (!target) {
    return
  }
  let role: CanvasWireRole = 'source'
  if (isGenerateKind(target.kind)) {
    const alreadyHasOtherBase = target.sourceId !== null && target.sourceId !== drag.image.id
    role = alreadyHasOtherBase ? 'precise' : 'img2img'
  }
  connectImageToOperation(target, drag.image, role)
  selectImage(target)
  const midpoint = connectBoxes(drag.image, target)
  activeWireEditor.value = {
    imageId: drag.image.id,
    operationId: target.id,
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
}

function startWireFromImage(image: CanvasImage, event: PointerEvent) {
  if (event.button !== 0) {
    return
  }
  activeWireEditor.value = null
  wireDrag.value = {
    pointerId: event.pointerId,
    image,
    pointer: localViewportPoint(event.clientX, event.clientY),
    hoveredOperationId: null,
  }
  window.addEventListener('pointermove', handleWirePointerMove)
  window.addEventListener('pointerup', finishWireDrag)
  window.addEventListener('pointercancel', cancelWireDrag)
}

function openWireEditor(edge: WorkflowEdge) {
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

function placeOperation(kind: CanvasTool, event?: MouseEvent, recipe?: NaiGenRequest) {
  const session = props.session
  const source = session.images.find((image) => image.id === session.selectedId)
  const node = newOperation(kind, session.nextImageId++, source)
  if (kind === 'generate' && source && !event) {
    node.sourceId = source.id
  }
  const at = worldPoint(event)
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
  if (!event) {
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
      preview: previewFor(item.asset),
      width,
      height,
    }
  }
  if (item.material.thumbnail) {
    const { width, height } = previewImageDimensions(
      item.material.asset.width,
      item.material.asset.height,
    )
    return {
      kind: 'image' as const,
      label: item.material.asset.label,
      meta: '',
      preview: favoritePreview(item.material.thumbnail),
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
  event.dataTransfer.setData(dragAssetMime, JSON.stringify(asset))
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
      hasThumbnail: Boolean(material.thumbnail),
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
  try {
    for (const file of files) {
      await importFile(file)
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

  const assetJson = transfer.getData(dragAssetMime)
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
    ? favoritePreview(thumbnailFor(asset.favoriteId))
    : previewFor(asset)
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
  if (!favorite?.thumbnail) {
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

function closeOperationDialog() {
  dialogNode.value = null
  focusViewport()
}

function runDialogOperation() {
  void toolbarRef.value?.runOperation()
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

async function handleAiEdit(edit: CanvasAiEdit, done: (summaries: string[]) => void) {
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
    done(result.summaries)
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

function triggerFileImport() {
  imageInput.value?.click()
}

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
              @click="triggerFileImport"
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
                  v-if="selectedFavorite.thumbnail"
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
                v-if="!selectedFavorite.thumbnail"
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
        @dragover.prevent
        @drop.prevent="dropOnCanvas"
        @pointerdown="handleViewportPointerDown"
        @pointermove="trackGesture"
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

        <div
          v-for="{ image, bounds } in visibleImages"
          :key="image.id"
          class="canvas-image-wrap"
          :style="{
            left: `${bounds.left}px`,
            top: `${bounds.top}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            zIndex: image.id === session.selectedId ? 2 : 1,
          }"
        >
          <button
            class="canvas-image"
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
            class="canvas-image-port"
            type="button"
            title="拖动连线到生图 / 重绘等盒子"
            aria-label="拖出工作流连线"
            @pointerdown.stop.prevent="startWireFromImage(image, $event)"
          >
            <Icon
              name="plus"
              :size="11"
            />
          </button>
        </div>

        <CanvasOperationCard
          v-for="{ node, bounds } in visibleOperations"
          :key="'op-' + node.id"
          :node="node"
          :session="session"
          :source-preview="operationSourcePreview(node)"
          :selected="node.id === session.selectedId"
          :wire-accepting="Boolean(wireDrag)"
          :wire-hovered="wireDrag?.hoveredOperationId === node.id"
          :style="{
            position: 'absolute',
            left: bounds.left + 'px',
            top: bounds.top + 'px',
            width: node.width + 'px',
            height: node.height + 'px',
            transform: 'scale(' + zoom + ')',
            zIndex: node.id === session.selectedId ? 2 : 1,
          }"
          @drag="beginGesture($event, node)"
          @select="selectImage(node)"
          @open-primary="openSelectedPrimaryTool(node)"
        />
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
            :image-preview="imagePreview"
            @remove="removeSelected"
            @spawn-operation="placeOperation"
            @start-wire="startWireFromImage"
            @open-dialog="openOperationDialog"
            @show-result="showResult"
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
          @click="triggerFileImport"
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
      />
    </Transition>

    <CanvasOperationDialog
      :node="dialogNode"
      :initial-tab="dialogTab"
      :session="session"
      @close="closeOperationDialog"
      @run="runDialogOperation"
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
