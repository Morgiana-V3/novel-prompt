<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { NaiGenParams, NaiGenResult, NaiImage, NaiVersion, InpaintDraft, InpaintPlan, AiInpaintResult } from '@shared/types'
import { readPngPrompt } from '@shared/prompt-import'
import { state, cleanErr, toDrafts } from '../store'
import Icon from './Icon.vue'
import ImageViewport from './ImageViewport.vue'
import ThemeSelect from './ThemeSelect.vue'
import { splitMaskComponent } from '../inpaint-mask'
import DiffChips from './DiffChips.vue'
import { diffSize } from '../tag-diff'
import { diffPrompt } from '../prompt-diff'
import { vAutosize } from '../autosize'
import { applyInpaintChanges, changeLabel } from '@shared/inpaint-plan'
import type { PageEditorState } from '@shared/page-workspace'

const props = defineProps<{ image: NaiImage; params: NaiGenParams; initialEditor?: PageEditorState; initialModel?: NaiVersion; initialRegionId?: string | null; selectionOnly?: boolean; saveEditor?: (snapshot: PageEditorState) => Promise<void> }>()
const emit = defineEmits<{ close: []; generated: [result: NaiGenResult]; busy: [value: boolean] }>()
const source = ref(props.image)
const sourceUrl = ref('')
const result = ref<NaiImage | null>(null)
const viewing = ref<'source' | 'result'>('source')
const loading = ref(true)
const frontendBusy = ref(false)
const stopFrontend = () => window.api.cancelFrontend()
let sourceReady: Promise<void> | undefined
const running = ref(false)
const error = ref('')
const status = ref('')
const promptNote = ref('')
const width = ref(0)
const height = ref(0)
const version = ref<NaiVersion>(props.initialModel ?? state.settings?.naiVersion ?? 'v4.5')
const draft = reactive({ base: state.prompt, negative: state.negative, characters: toDrafts(state.characters) })
const settings = reactive({ ...props.params, count: 1, seed: null as number | null, strength: 1 })
const freeOnly = computed(() => state.settings?.naiFreeOnly !== false)
const tool = ref<'brush' | 'erase' | 'rect'>('brush')
const brush = ref(48)
const opacity = ref(45)
const zoom = ref(100)
const opened = ref(true)
const mask = ref<HTMLCanvasElement>()
const previewMask = ref<HTMLCanvasElement>()
const dialog = ref<HTMLElement>()
const viewport = ref<InstanceType<typeof ImageViewport>>()
const coverage = ref(0)
const historyCount = ref(0)
const editable = computed(() => opened.value && !loading.value && !running.value && !analyzing.value && viewing.value === 'source' && !!sourceUrl.value)
const canRun = computed(() => opened.value && !loading.value && !running.value && !analyzing.value && coverage.value > 0 && !!sourceUrl.value)
type Point = { x: number; y: number }
type Stroke = { tool: typeof tool.value; radius: number; points: Point[] }
type Region = { id: string; label: string; number: number; annotated: boolean; anchor: Point | null; baseMask: HTMLCanvasElement | null; instruction: string; target: number | null; strokes: Stroke[]; hasPixels: boolean; plan: InpaintPlan | null; checked: boolean[]; accepted: InpaintDraft | null }
// UUIDs remain the data identity. Compact labels are unique for this editor's
// lifetime, including deleted regions; the number is only an internal sort key.
const usedLabels = new Set<string>()
function newLabel(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let length = 2, label: string
  while (usedLabels.size >= alphabet.length ** length) length++
  do { label = Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join('') }
  while (usedLabels.has(label))
  usedLabels.add(label)
  return label
}
let regionNumber = 0
const makeRegion = (): Region => ({ id: crypto.randomUUID(), label: newLabel(), number: 0, annotated: false, anchor: null, baseMask: null, instruction: '', target: null, strokes: [], hasPixels: false, plan: null, checked: [], accepted: null })
const regionLabel = (r: Region) => r.annotated ? `区域 ${r.label}` : '未批注选区'
const regions = ref<Region[]>([makeRegion()])
const selectedId = ref(regions.value[0].id)
const selected = computed(() => regions.value.find(r => r.id === selectedId.value) ?? regions.value[0])
const strokes = computed({ get: () => selected.value.strokes, set: value => { selected.value.strokes = value } })
const editDraft = computed(() => selected.value.accepted ?? draft)
const panel = ref<'regions' | 'suggestions' | 'prompt'>('prompt')
const analyzing = ref(false)
const analysisInfo = ref<AiInpaintResult | null>(null)
let analysisDraft: InpaintDraft | null = null
const commentAt = ref<{ x: number; y: number } | null>(null)
const contextAt = ref<{ x: number; y: number } | null>(null)
let contextPoint: Point | null = null
// Reviewing an annotation must not turn it back into the working paint layer.
// Only the explicit mask-edit action allows new strokes in an annotated region.
const editingMaskId = ref<string | null>(null)
const commentId = ref<string | null>(null)
const commentRegion = computed(() => regions.value.find(r => r.id === commentId.value))
const characterOptions = computed(() => [{ value: null as number | null, label: '由 AI 判断 / 背景' },
  ...draft.characters.map((_, i) => ({ value: i, label: `角色 ${i + 1}` }))])
const annotations = computed(() => regions.value.filter(r => r.annotated).sort((a, b) => a.number - b.number))
const analyzable = computed(() => annotations.value.filter(r => r.hasPixels && r.instruction.trim()))
const stopQueue = ref(false)
const batchReady = computed(() => annotations.value.filter(r => r.accepted && r.hasPixels))
const layerCache = new Map<string, HTMLCanvasElement>()
let resultDraft: InpaintDraft | null = null
const cloneDraft = (d: InpaintDraft): InpaintDraft => JSON.parse(JSON.stringify(d))
function invalidateRegion(r: Region) { r.plan = null; r.checked = []; r.accepted = null; layerCache.delete(r.id) }
function invalidateAll() { regions.value.forEach(invalidateRegion); analysisInfo.value = null; analysisDraft = null }
watch(() => JSON.stringify(draft) + version.value, invalidateAll)
function chooseRegion(r: Region) {
  if (running.value || analyzing.value || active) return
  selectedId.value = r.id
  commentAt.value = contextAt.value = null
  commentId.value = editingMaskId.value = null
  viewing.value = 'source'
  nextTick(() => { renderMask(); measureMask() })
}
function startFreshRegion(): boolean {
  // Unannotated painting is a working mask, not a numbered annotation. Reuse it
  // so users can paint several places first and attach their comments later.
  let r = regions.value.find(r => !r.annotated && !r.number) ?? regions.value.find(r => !r.annotated)
  if (!r) {
    r = makeRegion(); regions.value.push(r)
  }
  selectedId.value = r.id
  editingMaskId.value = null
  renderMask(); measureMask()
  return true
}
function editMask(r: Region) {
  if (!editable.value || active) return
  chooseRegion(r)
  editingMaskId.value = r.id
}
/* ---------- 可撤销的破坏性操作：清空遮罩、删除区域、删除批注 ---------- */
type RegionBackup = Pick<Region, 'annotated' | 'anchor' | 'baseMask' | 'instruction' | 'target' | 'strokes' | 'hasPixels' | 'plan' | 'checked' | 'accepted' | 'number'>
const backupRegion = (r: Region): RegionBackup => ({ annotated: r.annotated, anchor: r.anchor, baseMask: r.baseMask, instruction: r.instruction, target: r.target,
  strokes: [...r.strokes], hasPixels: r.hasPixels, plan: r.plan, checked: [...r.checked], accepted: r.accepted, number: r.number })
/** 最近一次破坏性操作；Ctrl+Z 或「撤销」优先恢复它，新的涂抹会让它失效 */
const lastRemoval = ref<{ label: string; restore: () => void } | null>(null)
function remember(label: string, restore: () => void) {
  lastRemoval.value = { label, restore }
  status.value = `${label}，可按 Ctrl+Z 或点击画布下方「撤销」恢复。`
}
function restoreRemoval() {
  const item = lastRemoval.value
  if (!item || active || running.value || analyzing.value) return
  lastRemoval.value = null
  item.restore()
  status.value = `已撤销：${item.label}`
}
function restoreRegion(r: Region, saved: RegionBackup) {
  Object.assign(r, saved)
  layerCache.delete(r.id)
  chooseRegion(r)
}
function removeRegion() {
  if (!editable.value || active) return
  const removed = selected.value
  const index = regions.value.indexOf(removed)
  const saved = backupRegion(removed)
  layerCache.delete(selectedId.value)
  regions.value = regions.value.filter(r => r.id !== selectedId.value)
  if (!regions.value.length) regions.value.push(makeRegion())
  chooseRegion(regions.value[0])
  remember(`已删除${removed.annotated ? `区域 ${removed.label}` : '选区'}`, () => {
    // 删除后补上的空白工作区没有内容，恢复时去掉，避免留下多余的空区域
    regions.value = regions.value.filter(r => r.hasPixels || r.annotated || r.strokes.length)
    regions.value.splice(Math.min(index, regions.value.length), 0, removed)
    restoreRegion(removed, saved)
  })
}
function layer(r: Region): HTMLCanvasElement {
  const cached = layerCache.get(r.id)
  if (cached) return cached
  const c = document.createElement('canvas'); c.width = width.value; c.height = height.value
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  if (r.baseMask) ctx.drawImage(r.baseMask, 0, 0)
  for (const stroke of r.strokes) drawStroke(ctx, stroke)
  layerCache.set(r.id, c)
  return c
}
function regionMarker(r: Region) {
  const p = r.anchor
  return p ? { left: `${p.x / width.value * 100}%`, top: `${p.y / height.value * 100}%` } : null
}
function floatingPosition(e?: MouseEvent, cardHeight = 300) {
  const rect = dialog.value!.getBoundingClientRect()
  const scale = rect.width / dialog.value!.offsetWidth
  return { x: Math.max(12, Math.min(dialog.value!.clientWidth - 300, e ? (e.clientX - rect.left) / scale : 50)),
    y: Math.max(12, Math.min(dialog.value!.clientHeight - cardHeight - 12, e ? (e.clientY - rect.top) / scale : 140)) }
}
function openContext(e: MouseEvent, region?: Region) {
  if (!editable.value || active) return
  let hit = region
  if (!hit) {
    const bounds = mask.value!.getBoundingClientRect()
    if (e.clientX < bounds.left || e.clientX >= bounds.right || e.clientY < bounds.top || e.clientY >= bounds.bottom) return
    const p = point(e)
    hit = [selected.value, ...regions.value.filter(r => r.id !== selectedId.value).reverse()].find(r =>
      layer(r).getContext('2d')!.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 0)
  }
  if (!hit) { contextAt.value = null; return }
  chooseRegion(hit)
  contextPoint = region?.anchor ?? point(e)
  contextAt.value = floatingPosition(e, 150)
  nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('.ip-context-menu button')?.focus())
}
function openComment() {
  if (!editable.value || !selected.value.hasPixels) return
  lastRemoval.value = null
  let r = selected.value
  if (!r.annotated) {
    if (annotations.value.length >= 8) { error.value = '最多保留 8 条批注，请先删除不用的批注。'; contextAt.value = null; return }
    if (!contextPoint) return
    const data = layer(r).getContext('2d')!.getImageData(0, 0, width.value, height.value)
    const split = splitMaskComponent(data.data, width.value, height.value, contextPoint.x, contextPoint.y)
    if (!split) return
    if (split.hasRemainder) {
      const extracted = makeRegion()
      extracted.baseMask = maskFromPixels(split.component)
      extracted.hasPixels = true
      extracted.number = r.number
      r.baseMask = maskFromPixels(split.remainder); r.strokes = []; r.number = 0
      invalidateRegion(r)
      regions.value.push(extracted)
      selectedId.value = extracted.id
      r = selected.value
    }
    if (!r.number) r.number = ++regionNumber
    r.anchor = { ...contextPoint }
    r.annotated = true
    renderMask(); measureMask()
  }
  commentId.value = r.id
  editingMaskId.value = null
  const at = contextAt.value
  contextAt.value = null
  commentAt.value = at ? { x: at.x, y: Math.min(at.y, dialog.value!.clientHeight - 320) } : floatingPosition()
  nextTick(() => dialog.value?.querySelector<HTMLTextAreaElement>('.ip-comment textarea')?.focus())
}
function finishComment() {
  commentAt.value = null
  commentId.value = null
  editingMaskId.value = null
  dialog.value?.focus({ preventScroll: true })
}
function dismissFloating(e: PointerEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.ip-comment, .ip-context-menu')) return
  contextAt.value = null
  if (commentAt.value) finishComment()
}
function deleteAnnotation(r: Region) {
  if (running.value || analyzing.value) return
  const saved = backupRegion(r), label = r.label
  remember(`已删除区域 ${label} 的批注`, () => restoreRegion(r, saved))
  r.annotated = false; r.instruction = ''; r.target = null; invalidateRegion(r)
  contextAt.value = commentAt.value = null
  commentId.value = null
  editingMaskId.value = null
}
async function analyzeRegions() {
  if (!editable.value || analyzing.value) return
  const annotated = analyzable.value
  if (!annotated.length) { error.value = '请先涂选区域并填写修改批注'; return }
  lastRemoval.value = null
  error.value = ''; analyzing.value = true; commentAt.value = contextAt.value = null
  const snapshot = cloneDraft(draft)
  try {
    const response = await window.api.planInpaint({ imageName: source.value.name, width: width.value, height: height.value,
      version: version.value, draft: snapshot,
      regions: annotated.map(r => ({ id: r.id, label: r.label, instruction: r.instruction, target: r.target, mask: exportMask(r) })) })
    if (!alive || !opened.value) return
    analysisDraft = snapshot; analysisInfo.value = response
    for (const r of annotated) { r.plan = response.plans.find(p => p.id === r.id) ?? null; r.checked = r.plan?.changes.map(() => true) ?? []; r.accepted = null }
    panel.value = 'suggestions'
  } catch (e) { if (alive) error.value = cleanErr(e) }
  finally { analyzing.value = false }
}
function adopt(r: Region) {
  if (!r.plan || !analysisDraft || analyzing.value || running.value || !r.checked.some(Boolean)) return
  lastRemoval.value = null
  try {
    r.accepted = applyInpaintChanges(draft, r.plan.changes.filter((_, i) => r.checked[i]))
    status.value = `区域 ${r.label} 已采纳，可在「提示词」中继续编辑；尚未生成图片。`
  } catch (e) { error.value = cleanErr(e) }
}
function adoptAll() { regions.value.filter(r => r.plan?.changes.length).forEach(adopt) }
const cancelAnalysis = () => window.api.cancelInpaintPlan()

let active: Stroke | null = null
let pointer: number | null = null
const previousFocus = document.activeElement as HTMLElement | null
let unsubscribe: (() => void) | undefined
let alive = true
let savingSnapshot: Promise<void> | null = null
let snapshotTimer: ReturnType<typeof setTimeout> | undefined
function editorSnapshot(): PageEditorState {
  const { strength, ...params } = settings
  return { draft: cloneDraft(draft), params: { ...params, width: width.value, height: height.value, seed: params.seed === null || (params.seed as unknown) === '' ? null : Number(params.seed) }, strength,
    regions: regions.value.filter(r => r.hasPixels).map(r => ({ id: r.id, label: r.label, instruction: r.instruction, target: r.target,
      anchor: r.anchor ? { ...r.anchor } : null, annotated: r.annotated, mask: exportMask(r), accepted: r.accepted ? cloneDraft(r.accepted) : null })) }
}
async function persistEditor() {
  if (!props.saveEditor || loading.value || !sourceUrl.value || active) return
  if (savingSnapshot) await savingSnapshot
  const request = props.saveEditor(editorSnapshot())
  savingSnapshot = request
  try { await request }
  finally { if (savingSnapshot === request) savingSnapshot = null }
}
watch([regions, draft, settings], () => {
  if (!props.saveEditor || loading.value || frontendBusy.value) return
  clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => { void persistEditor().catch(e => { error.value = `选区保存失败：${cleanErr(e)}` }) }, 800)
}, { deep: true })
async function restoreEditor(saved: PageEditorState) {
  Object.assign(draft, cloneDraft(saved.draft)); Object.assign(settings, saved.params, { strength: saved.strength })
  await nextTick() // Let draft invalidation finish before restoring accepted suggestions.
  const restored: Region[] = []
  for (const item of saved.regions) {
    const img = new Image(); img.src = `data:image/png;base64,${item.mask}`; await img.decode()
    const c = document.createElement('canvas'); c.width = width.value; c.height = height.value
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, width.value, height.value)
    for (let i = 0; i < pixels.data.length; i += 4) { const a = pixels.data[i]; pixels.data.set([255, 107, 154, a], i) }
    ctx.putImageData(pixels, 0, 0); usedLabels.add(item.label)
    restored.push({ ...makeRegion(), ...item, number: item.annotated ? ++regionNumber : 0, baseMask: markRaw(c), strokes: [], hasPixels: true })
  }
  regions.value = restored.length ? restored : [makeRegion()]; selectedId.value = regions.value.find(r => r.id === props.initialRegionId)?.id ?? regions.value[0].id
  promptNote.value = '已恢复当前版本的提示词、选区和批注。'
  renderMask(); measureMask(); panel.value = 'regions'
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over'
  ctx.fillStyle = '#ff6b9a'
  ctx.strokeStyle = '#ff6b9a'
  const first = stroke.points[0]
  if (stroke.tool === 'rect') {
    const end = stroke.points[stroke.points.length - 1]
    ctx.fillRect(Math.min(first.x, end.x), Math.min(first.y, end.y), Math.abs(end.x - first.x), Math.abs(end.y - first.y))
    return
  }
  ctx.lineWidth = stroke.radius * 2
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
}
function maskFromPixels(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width.value; canvas.height = height.value
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.createImageData(width.value, height.value)
  data.data.set(pixels); ctx.putImageData(data, 0, 0)
  return markRaw(canvas)
}
function renderMask() {
  const ctx = mask.value?.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.clearRect(0, 0, width.value, height.value)
  ctx.globalCompositeOperation = 'source-over'
  // Display, hit testing, splitting and export all use the same raster. Drawing
  // strokes again on a different canvas can produce different edge coverage.
  ctx.drawImage(layer(selected.value), 0, 0)
  if (active) drawStroke(ctx, active)
  ctx.globalCompositeOperation = 'source-over'
  // Composite every region before applying the user's opacity once. Selection,
  // comments and overlapping masks must never change the preview's strength.
  const preview = previewMask.value?.getContext('2d')
  if (preview) {
    preview.clearRect(0, 0, width.value, height.value)
    // Keep compositing order and source canvases independent of selection.
    // Only the unfinished stroke needs the temporary interaction surface.
    for (const r of regions.value) preview.drawImage(active && r.id === selectedId.value ? mask.value! : layer(r), 0, 0)
    preview.globalCompositeOperation = 'source-in'
    preview.fillStyle = '#ff6b9a'
    preview.fillRect(0, 0, width.value, height.value)
    preview.globalCompositeOperation = 'source-over'
  }
}
function measureMask() {
  const data = mask.value?.getContext('2d')?.getImageData(0, 0, width.value, height.value).data
  let count = 0
  if (data) for (let i = 3; i < data.length; i += 4) if (data[i]) count++
  coverage.value = data ? count / (data.length / 4) * 100 : 0
  selected.value.hasPixels = count > 0
  historyCount.value = strokes.value.length + (selected.value.baseMask ? 1 : 0)
}
function point(e: MouseEvent): Point {
  const bounds = mask.value!.getBoundingClientRect()
  return { x: Math.max(0, Math.min(width.value, (e.clientX - bounds.left) / bounds.width * width.value)), y: Math.max(0, Math.min(height.value, (e.clientY - bounds.top) / bounds.height * height.value)) }
}
function down(e: PointerEvent) {
  if (!editable.value || e.button !== 0 || pointer !== null) return
  e.preventDefault()
  if (selected.value.annotated && editingMaskId.value !== selectedId.value && tool.value !== 'erase' && !startFreshRegion()) return
  pointer = e.pointerId
  active = { tool: tool.value, radius: brush.value / 2, points: [point(e)] }
  mask.value!.setPointerCapture(e.pointerId)
  renderMask()
}
function move(e: PointerEvent) {
  if (!active || pointer !== e.pointerId) return
  if (active.tool === 'rect') active.points = [active.points[0], point(e)]
  else active.points.push(point(e))
  renderMask()
}
function up(e: PointerEvent) {
  if (!active || pointer !== e.pointerId) return
  if (e.type !== 'pointercancel') { move(e); strokes.value.push(active); invalidateRegion(selected.value); lastRemoval.value = null; confirmingClose.value = false }
  active = null
  pointer = null
  if (mask.value?.hasPointerCapture(e.pointerId)) mask.value.releasePointerCapture(e.pointerId)
  renderMask()
  measureMask()
}
function undo() {
  if (!editable.value || active) return
  if (lastRemoval.value) return restoreRemoval()
  // 只撤销本次涂抹的笔画；已恢复或拆分得到的底层遮罩（baseMask）不是一笔操作，不能被一次 Ctrl+Z 整块清掉
  if (!strokes.value.length) return
  strokes.value.pop()
  invalidateRegion(selected.value)
  renderMask()
  measureMask()
}
function cancelDraw() {
  const id = pointer
  active = null
  pointer = null
  if (id !== null && mask.value?.hasPointerCapture(id)) mask.value.releasePointerCapture(id)
  renderMask()
  measureMask()
}
function clearMask() {
  if (active) return
  strokes.value = []
  selected.value.baseMask = null
  invalidateRegion(selected.value)
  renderMask()
  measureMask()
}
function userClearMask() {
  if (!editable.value || active) return
  const r = selected.value, saved = backupRegion(r)
  clearMask()
  remember(`已清空${r.annotated ? `区域 ${r.label} 的` : '当前'}遮罩`, () => restoreRegion(r, saved))
}
const canUndo = computed(() => !!lastRemoval.value || selected.value.strokes.length > 0)
/** 生图页的完整模式不会自动保存，关闭即丢失；有内容时需要再确认一次 */
const confirmingClose = ref(false)
const hasUnsavedWork = computed(() => !props.saveEditor && regions.value.some(r => r.hasPixels || r.instruction.trim() || r.accepted))
function exportMask(region = selected.value): string {
  const data = layer(region).getContext('2d')!.getImageData(0, 0, width.value, height.value)
  for (let i = 0; i < data.data.length; i += 4) {
    const alpha = data.data[i + 3]
    data.data[i] = data.data[i + 1] = data.data[i + 2] = alpha
    data.data[i + 3] = 255
  }
  const output = document.createElement('canvas')
  output.width = width.value
  output.height = height.value
  output.getContext('2d')!.putImageData(data, 0, 0)
  return output.toDataURL('image/png').split(',')[1]
}

async function loadSource(image: NaiImage, readPrompt = true) {
  loading.value = true
  error.value = ''
  let url = ''
  try {
    const bytes = await window.api.naiReadImage(image.name)
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    await img.decode()
    if (!alive) { URL.revokeObjectURL(url); return }
    if (img.naturalWidth * img.naturalHeight > 4 * 1024 * 1024 || img.naturalWidth % 64 || img.naturalHeight % 64)
      throw new Error('原图宽高需为 64 的倍数，总像素不超过 4096×1024；重绘会保持原图尺寸。')
    if (readPrompt) {
      try {
        const meta = await readPngPrompt(blob)
        draft.base = meta.base
        draft.negative = meta.negative
        draft.characters = toDrafts(meta.characters)
        settings.qualityTags = false
        settings.ucPreset = 'none'
        promptNote.value = '已读取原图提示词，只需改动想调整的描述。'
      } catch {
        promptNote.value = '原图没有可读取的提示词，已使用当前工作区内容，请核对后修改。'
      }
    }
    if (!alive) { URL.revokeObjectURL(url); return }
    if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
    sourceUrl.value = url
    source.value = image
    width.value = img.naturalWidth
    height.value = img.naturalHeight
    result.value = null
    viewing.value = 'source'
    zoom.value = 100
    if (!readPrompt && resultDraft) { draft.base = resultDraft.base; draft.negative = resultDraft.negative; draft.characters = toDrafts(resultDraft.characters) }
    resultDraft = null; layerCache.clear()
    regionNumber = 0; regions.value = [makeRegion()]; selectedId.value = regions.value[0].id
    lastRemoval.value = null; confirmingClose.value = false
    analysisDraft = null; analysisInfo.value = null; commentAt.value = contextAt.value = null; commentId.value = editingMaskId.value = null
    await nextTick()
    viewport.value?.reset()
    clearMask()
    if (readPrompt && props.initialEditor) await restoreEditor(props.initialEditor)
  } catch (e) {
    if (url) URL.revokeObjectURL(url)
    error.value = cleanErr(e)
  } finally { loading.value = false }
}

async function generate(batch = false) {
  if (batch ? running.value || analyzing.value || loading.value || !batchReady.value.length : !canRun.value) return
  if (!state.settings?.naiToken?.trim()) { error.value = '请先在设置中填写 NovelAI Token'; return }
  if (!editDraft.value.base.trim() && !editDraft.value.characters.some(c => c.prompt.trim())) { error.value = '请填写希望重绘后呈现的内容'; return }
  error.value = ''
  lastRemoval.value = null
  status.value = '检查重绘参数…'
  running.value = true
  commentAt.value = contextAt.value = null
  emit('busy', true)
  stopQueue.value = false
  try {
    const params: NaiGenParams = { ...settings, width: width.value, height: height.value, count: 1,
      seed: settings.seed === null || (settings.seed as unknown) === '' ? null : Number(settings.seed) }
    const queue = (batch ? batchReady.value : [selected.value]).map(r => ({ label: regionLabel(r), mask: exportMask(r), draft: cloneDraft(r.accepted ?? draft) }))
    let imageName = source.value.name
    for (let i = 0; i < queue.length; i++) {
      if (stopQueue.value) { status.value = `已停止后续重绘，完成 ${i}/${queue.length} 个区域，已有结果保留。`; break }
      const item = queue[i]
      status.value = `正在重绘${item.label}（${i + 1}/${queue.length}）…`
      const response = await window.api.naiInpaint({ ...item.draft, params, version: version.value,
        inpaint: { imageName, mask: item.mask, strength: settings.strength } })
      emit('generated', response)
      if (!response.images.length) { error.value = response.stopped ?? '没有收到重绘结果，队列已停止'; break }
      result.value = response.images[response.images.length - 1]
      resultDraft = item.draft
      imageName = result.value.name
      viewing.value = 'result'
      status.value = response.stopped ?? `已完成 ${i + 1}/${queue.length} 个区域，重绘结果已另存到图库。`
      if (response.stopped) break
    }
  } catch (e) { error.value = cleanErr(e); status.value = '' }
  finally { running.value = false; emit('busy', false) }
}
async function close() {
  if (running.value) return
  if (hasUnsavedWork.value && !confirmingClose.value) {
    confirmingClose.value = true
    return
  }
  clearTimeout(snapshotTimer)
  try { await persistEditor() } catch (e) { error.value = `尚未保存，请重试：${cleanErr(e)}`; return }
  if (analyzing.value) void window.api.cancelInpaintPlan()
  opened.value = false
}
function key(e: KeyboardEvent) {
  if (frontendBusy.value) return
  if (!opened.value) return
  // 连按 Esc 关浮层时不能顺手把整个编辑器关掉：确认条出现后 Esc 只取消确认，需点「仍然关闭」
  if (e.key === 'Escape') { if (contextAt.value) { contextAt.value = null; dialog.value?.focus() } else if (commentAt.value) finishComment(); else if (confirmingClose.value) confirmingClose.value = false; else close(); return }
  if (e.key === 'Tab' && dialog.value) {
    const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')]
      .filter(el => el.getClientRects().length && !el.closest('fieldset:disabled'))
    const first = controls[0], last = controls[controls.length - 1]
    if (!first) { e.preventDefault(); return }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.value || !dialog.value.contains(document.activeElement))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) { e.preventDefault(); first.focus() }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName)) {
    e.preventDefault(); undo()
  }
}
onMounted(() => {
  unsubscribe = window.api.onNaiStep('inpaint', s => { if (running.value) status.value = s })
  window.addEventListener('keydown', key)
  dialog.value?.focus({ preventScroll: true })
  sourceReady = loadSource(props.image)
})
async function frontendRegion(a: import('@shared/desktop').FrontendRequest, ctx: import('@shared/desktop').FrontendContext) {
  frontendBusy.value = true
  try {
    await sourceReady
    if (loading.value || error.value || !sourceUrl.value || !props.selectionOnly || !props.saveEditor) throw new Error(error.value || '选区编辑器尚未就绪')
    const existing = a.action !== 'region'
    const removing = a.action === 'region-delete'
    if (!existing && regions.value.filter(r => r.hasPixels).length >= 16) throw new Error('最多保留 16 个区域')
    if (a.target != null && a.target >= draft.characters.length) throw new Error('角色索引超出当前角色数量')
    const rectangles = a.rectangles ?? []
    if (rectangles.some(r => r.x + r.width > width.value || r.y + r.height > height.value)) throw new Error('选区超出原图边界')
    let r = existing ? regions.value.find(r => r.id === a.region_id && r.hasPixels) : undefined
    if (existing && !r) throw new Error('区域不存在')
    if (removing && a.confirm !== true) throw new Error('缺少删除区域授权')
    await ctx.step('已打开原图选区编辑器')
    if (!r) { r = makeRegion(); regions.value.push(r) }
    chooseRegion(r); tool.value = 'rect'; panel.value = 'regions'
    await nextTick(); renderMask(); measureMask()
    if (existing) await ctx.step(`已定位区域 ${r.label}`)
    if (removing) {
      await ctx.step(`即将删除区域 ${r.label} 的遮罩与批注`)
      removeRegion()
    } else {
      if (a.rectangles !== undefined) {
        r.baseMask = null; r.strokes = []
        for (const rect of rectangles) r.strokes.push({ tool:'rect', radius:brush.value, points:[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height}] })
        r.anchor = { x:rectangles[0].x + rectangles[0].width / 2, y:rectangles[0].y + rectangles[0].height / 2 }
      }
      invalidateRegion(r); await nextTick(); renderMask(); measureMask()
      if (a.rectangles !== undefined) await ctx.step(existing ? '已更新区域遮罩，尚未保存' : '已在原图上绘制遮罩')
      if (a.instruction !== undefined) r.instruction = a.instruction
      if (a.target !== undefined) r.target = a.target
      r.annotated = true; if (!r.number) r.number = ++regionNumber
      await ctx.step(existing ? '区域批注已更新，尚未保存' : '已填写区域批注')
    }
    if (ctx.signal.aborted) throw new Error('已停止，未保存区域修改')
    clearTimeout(snapshotTimer); await persistEditor()
    await ctx.step(removing ? '区域已删除' : '区域批注已保存')
    opened.value = false
    return r.id
  } finally { await nextTick(); clearTimeout(snapshotTimer); frontendBusy.value = false }
}
defineExpose({ frontendRegion })
onBeforeUnmount(() => {
  clearTimeout(snapshotTimer)
  alive = false
  if (analyzing.value) void window.api.cancelInpaintPlan()
  unsubscribe?.()
  window.removeEventListener('keydown', key)
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear @after-leave="emit('close')">
    <div v-if="opened" class="ip-mask" @pointerdown.capture="dismissFloating">
      <div v-if="frontendBusy" style="position:absolute;top:8px;right:24px;z-index:2"><button class="btn small" @click="stopFrontend">停止 Agent 前台操作</button></div>
      <div ref="dialog" class="ip-dialog modal-panel" :inert="frontendBusy" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ip-title">
        <div class="ip-head">
          <span class="group-badge pink"><Icon name="edit" :size="16" /></span>
          <h3 id="ip-title">{{ selectionOnly ? '页面选区与提示词' : '局部重绘' }}</h3>
          <span class="pill" v-if="width">{{ width }}×{{ height }}</span>
          <button class="icon-btn sm ml-auto" title="关闭（Esc）" :disabled="running" @click="close"><Icon name="x" :size="16" /></button>
        </div>
        <div class="ip-body">
          <div class="ip-work">
            <div class="ip-tools">
              <div class="seg">
                <button :class="{ on: tool === 'brush' }" :disabled="!editable" @click="tool = 'brush'"><Icon name="edit" :size="14" />画笔</button>
                <button :class="{ on: tool === 'erase' }" :disabled="!editable" @click="tool = 'erase'">橡皮</button>
                <button :class="{ on: tool === 'rect' }" :disabled="!editable" @click="tool = 'rect'"><Icon name="frame" :size="14" />框选</button>
              </div>
              <button class="icon-btn sm" title="撤销（Ctrl+Z）" :disabled="!editable || !canUndo" @click="undo"><Icon name="reset" :size="15" /></button>
              <button class="btn ghost small" title="清空当前区域的遮罩，可撤销" :disabled="!editable || !historyCount" @click="userClearMask">清空</button>
              <div class="seg ml-auto" v-if="result">
                <button :class="{ on: viewing === 'source' }" @click="viewing = 'source'">原图 / 遮罩</button>
                <button :class="{ on: viewing === 'result' }" @click="viewing = 'result'">重绘结果</button>
              </div>
            </div>
            <div class="ip-sliders">
              <label>笔刷 {{ brush }} px<input class="range" type="range" min="4" max="200" step="2" v-model.number="brush" :disabled="!editable || tool === 'rect'" aria-label="笔刷大小" /></label>
              <label>遮罩 {{ opacity }}%<input class="range" type="range" min="10" max="80" step="5" v-model.number="opacity" aria-label="遮罩不透明度" /></label>
              <label>缩放 {{ zoom }}%<input class="range" type="range" min="25" max="1600" step="1" v-model.number="zoom" aria-label="画布缩放" /></label>
            </div>
            <div class="ip-navigation muted small"><button class="btn ghost small ml-auto" title="滚轮缩放；空格 + 拖动或中键拖动" @click="viewport?.reset()">适应画布</button></div>
            <ImageViewport class="ip-viewport" ref="viewport" :width="width" :height="height" v-model:zoom="zoom" :editable="editable" :tool="tool" :brush-size="brush" label="局部重绘画布" @cancel-draw="cancelDraw" @contextmenu.prevent="openContext">
                <template v-if="sourceUrl">
                  <img :src="viewing === 'result' && result ? result.url : sourceUrl" alt="局部重绘画布" draggable="false" />
                  <canvas ref="previewMask" class="ip-mask-preview" v-show="viewing === 'source'" :width="width" :height="height" :style="{ opacity: opacity / 100 }" aria-hidden="true" />
                  <canvas ref="mask" class="ip-active-mask" v-show="viewing === 'source'" :width="width" :height="height"
                    :class="{ locked: !editable }" aria-label="涂抹需要重绘的区域" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="cancelDraw" />
                  <template v-if="viewing === 'source'">
                    <button v-for="r in annotations.filter(r => r.hasPixels)" :key="r.id" class="ip-marker" :style="regionMarker(r)" :disabled="running || analyzing" :title="`区域 ${r.label}：${r.instruction || '尚未填写批注'}`" :aria-label="`区域 ${r.label}`" @click.stop="chooseRegion(r)" @contextmenu.stop.prevent="openContext($event, r)">{{ r.label }}</button>
                  </template>
                </template>
            </ImageViewport>
            <div class="ip-canvas-foot">
              <span><i></i>{{ regionLabel(selected) }} · 已选 {{ coverage.toFixed(1) }}%</span>
              <button v-if="lastRemoval" class="btn small" :disabled="running || analyzing" :title="lastRemoval.label" @click="restoreRemoval"><Icon name="reset" :size="13" />撤销{{ lastRemoval.label.replace(/^已/, '') }}</button>
              <button v-if="editingMaskId" class="btn ghost small" @click="editingMaskId = null">完成遮罩编辑</button>
              <button v-if="result" class="btn small primary" :disabled="running || loading" @click="loadSource(result, false)"><Icon name="check" :size="13" />以结果继续修改</button>
            </div>
          </div>
          <div class="ip-settings scroll">
            <div class="seg ip-tabs"><button :class="{ on: panel === 'regions' }" @click="panel = 'regions'">修改批注</button><button v-if="!selectionOnly" :class="{ on: panel === 'suggestions' }" @click="panel = 'suggestions'">AI 建议</button><button :class="{ on: panel === 'prompt' }" @click="panel = 'prompt'">提示词</button></div>
            <div v-show="panel === 'regions'" class="ip-ai-section">
              <p v-if="!annotations.length" class="muted small">涂抹后右键添加批注</p>
              <details v-for="r in annotations" :key="r.id" class="ip-annotation-item">
                <summary><b>区域 {{ r.label }}</b><span>{{ r.instruction.trim() || '未填写修改要求' }}</span><small>{{ r.target === null ? '自动 / 背景' : `角色 ${r.target + 1}` }}</small></summary>
                <div class="ip-annotation-fields">
                  <textarea v-autosize class="input ip-annotation" v-model="r.instruction" :disabled="running || analyzing" @input="invalidateRegion(r)" placeholder="支持自然语言、tag、权重，可稍后填写…" aria-label="区域修改批注"></textarea>
                  <label class="field-label">对应角色<ThemeSelect class="sm" v-model="r.target" :options="characterOptions" :disabled="running || analyzing" @update:model-value="invalidateRegion(r)" aria-label="批注对应角色" /></label>
                  <details v-if="r.target !== null && (r.accepted ?? draft).characters[r.target]" class="ip-character-note">
                    <summary>角色 {{ r.target + 1 }} 提示词</summary>
                    <textarea v-autosize class="input ip-annotation" v-model="(r.accepted ?? draft).characters[r.target].prompt" :disabled="running || analyzing" aria-label="批注角色提示词"></textarea>
                  </details>
                  <div class="row"><button class="btn ghost small" :disabled="running || analyzing" @click="editMask(r)">编辑此区域遮罩</button><button class="btn ghost small" :disabled="running || analyzing" @click="deleteAnnotation(r)">删除批注</button></div>
                </div>
              </details>
              <button v-if="!selectionOnly" class="btn primary" :title="`使用 ${state.settings?.model || '设置中的模型'} 分析原图和有内容的批注（${analyzable.length}/${annotations.length}）`" :disabled="!editable || !analyzable.length" @click="analyzeRegions">分析批注</button>
              <button v-if="analyzing" class="btn ghost small" @click="cancelAnalysis">取消分析</button>
              <span v-if="analyzing" class="muted small" role="status">AI 正在分析选区与提示词…</span>
            </div>
            <div v-show="panel === 'suggestions'" class="ip-ai-section">
              <div v-if="!analysisInfo" class="ip-note">先在区域上填写修改批注，再点击分析。AI 会提出建议，由你选择采纳。</div>
              <template v-else>
                <details class="ip-analysis-details"><summary>本轮 Skill · {{ analysisInfo.skills.length }}</summary>{{ analysisInfo.skills.join('、') || '未启用 Skill' }}</details>
                <button class="btn primary small" :disabled="running || analyzing" @click="adoptAll">采纳各区域已勾选的修改</button>
                <article v-for="r in annotations.filter(r => r.plan)" :key="r.id" class="ip-plan">
                  <button class="btn ghost small" @click="chooseRegion(r)">区域 {{ r.label }}{{ r.accepted ? ' · 已采纳' : '' }}</button>
                  <p>{{ r.plan!.summary }}</p><p v-if="r.plan!.warning" class="ip-plan-warning">{{ r.plan!.warning }}</p>
                  <div v-for="(change, i) in r.plan!.changes" :key="i" class="ip-change">
                    <label><input type="checkbox" v-model="r.checked[i]" :disabled="running || analyzing" @change="r.accepted = null" /> {{ changeLabel(change) }}</label>
                    <DiffChips :diff="diffPrompt(change.before, change.after)" />
                    <span v-if="!diffSize(diffPrompt(change.before, change.after))" class="muted small">仅调整顺序或格式</span>
                    <small>{{ change.reason }}</small>
                    <details class="ip-full-change"><summary>查看完整前后文本</summary><div><b>修改前</b><p>{{ change.before || '（空）' }}</p><b>修改后</b><p>{{ change.after || '（清空）' }}</p></div></details>
                  </div>
                  <div class="row"><button class="btn primary small" :disabled="running || analyzing || !r.checked.some(Boolean)" @click="adopt(r)">采纳此区域</button><button v-if="r.accepted" class="btn ghost small" :disabled="running || analyzing" @click="r.accepted = null">撤销采纳</button></div>
                </article>
              </template>
            </div>
            <div v-show="panel === 'prompt'">
              <div v-if="selected.accepted" class="pill">区域 {{ selected.label }} · 已采纳</div>
            <details class="ip-analysis-details"><summary>提示词来源</summary>{{ promptNote || '正在读取图片提示词…' }}</details>
            <fieldset :disabled="loading || running || analyzing">
              <label class="field-label" for="ip-prompt">重绘提示词</label>
              <textarea v-autosize id="ip-prompt" class="input ip-textarea" v-model="editDraft.base" spellcheck="false" placeholder="描述完成后的画面，例如 white shirt, long sleeves…"></textarea>
              <label class="field-label" for="ip-negative">负面提示词</label>
              <textarea v-autosize id="ip-negative" class="input ip-textarea ip-negative" v-model="editDraft.negative" spellcheck="false" placeholder="不希望出现的内容"></textarea>
              <details class="ip-details" v-if="editDraft.characters.length">
                <summary>角色提示词 · {{ editDraft.characters.length }} 个</summary>
                <div class="ip-character" v-for="(character, i) in editDraft.characters" :key="i">
                  <label class="field-label" :for="'ip-char-' + i">角色 {{ i + 1 }} <span class="muted">{{ character.position || '自动位置' }}</span></label>
                  <textarea v-autosize :id="'ip-char-' + i" class="input ip-textarea" v-model="character.prompt" :aria-label="`角色 ${i + 1} 提示词`" spellcheck="false"></textarea>
                  <textarea v-autosize class="input ip-textarea ip-negative" v-model="character.negative" :aria-label="`角色 ${i + 1} 负面`" placeholder="角色负面" spellcheck="false"></textarea>
                </div>
              </details>
              <div class="ip-strength">
                <label for="ip-strength">重绘强度 <b>{{ settings.strength.toFixed(2) }}</b></label>
                <input id="ip-strength" class="range" type="range" min="0.01" max="1" step="0.01" v-model.number="settings.strength" />
                <div class="ip-scale-label"><span>保留原有细节</span><span>更大幅度重画</span></div>
              </div>
              <div class="ip-param-grid">
                <label>模型<ThemeSelect class="sm" v-model="version" :disabled="selectionOnly" :options="[{value: 'v4.5', label: 'V4.5 Full'}, {value: 'v5', label: 'V5 Full'}]" aria-label="重绘模型" /></label>
                <label>步数<input class="input sm" type="number" min="1" max="50" v-model.number="settings.steps" /></label>
                <label>Guidance<input class="input sm" type="number" min="0" max="10" step="0.1" v-model.number="settings.scale" /></label>
                <label>种子<input class="input sm" type="number" min="0" max="4294967295" v-model.number="settings.seed" placeholder="随机" /></label>
              </div>
            </fieldset>
            <span class="pill" :title="freeOnly ? '提交前检查尺寸、步数和会员额度' : '生成后核对余额'">{{ freeOnly ? '仅免费额度' : '允许消耗 Anlas' }}</span>
            </div>
            <div v-if="error" class="error-box" role="alert"><Icon name="warn" :size="15" />{{ error }}</div>
            <div v-if="status" class="ip-status" role="status">{{ status }}</div>
          </div>
        </div>
        <div v-if="confirmingClose" class="ip-close-confirm" role="alertdialog" aria-label="确认关闭">
          <Icon name="warn" :size="15" />
          <span>关闭后，本次涂抹的选区、批注和 AI 建议都不会保留（已生成的图片在图库中）。</span>
          <button class="btn ghost small ml-auto" @click="confirmingClose = false">继续编辑</button>
          <button class="btn small danger" @click="close">仍然关闭</button>
        </div>
        <div class="ip-foot">
          <span v-if="running || !coverage" class="muted small">{{ running ? '正在重绘…' : '请先选择区域' }}</span>
          <button v-if="running" class="btn ghost small" @click="stopQueue = true">{{ stopQueue ? '将在本张完成后停止' : '停止后续区域' }}</button>
          <button v-if="!selectionOnly && batchReady.length" title="按批注顺序生成，每一区域以上一区域结果为底图；重新执行从原图开始" class="btn primary" :disabled="running || analyzing || loading" @click="generate(true)">生成已采纳的 {{ batchReady.length }} 个区域</button>
          <button v-if="!selectionOnly" class="btn accent ml-auto" :disabled="!canRun" @click="generate(false)"><Icon name="wand" :size="16" :class="{ 'spin-slow': running }" />{{ running ? '正在重绘' : result ? '再试当前区域' : '重绘当前区域' }}</button>
          <button v-else class="btn accent ml-auto" :disabled="loading" @click="close"><Icon name="check" :size="16" />保存并返回讨论</button>
        </div>
        <Transition name="fade">
          <div v-if="contextAt" class="ip-context-menu" :style="{ left: contextAt.x + 'px', top: contextAt.y + 'px' }" role="menu" aria-label="选区操作">
            <button role="menuitem" @click="openComment">{{ selected.annotated ? '修改批注' : '新增批注' }}</button>
            <button role="menuitem" @click="editMask(selected)">编辑此区域遮罩</button>
            <button v-if="selected.annotated" role="menuitem" @click="deleteAnnotation(selected)">删除批注（保留选区）</button>
            <button role="menuitem" @click="removeRegion">删除此区域</button>
          </div>
        </Transition>
        <Transition name="fade">
        <div v-if="commentAt && commentRegion" class="ip-comment" :style="{ left: commentAt.x + 'px', top: commentAt.y + 'px' }" role="group" :aria-label="`区域 ${commentRegion.label} 批注`">
          <div class="row"><b>区域 {{ commentRegion.label }}</b><button class="icon-btn sm ml-auto" title="收起批注" @click="finishComment"><Icon name="x" :size="14" /></button></div>
          <textarea v-autosize class="input ip-annotation" v-model="commentRegion.instruction" @input="invalidateRegion(commentRegion)" placeholder="描述想修改的内容，支持自然语言、tag、权重…" aria-label="浮动区域批注"></textarea>
          <label class="field-label">对应角色<ThemeSelect class="sm" v-model="commentRegion.target" :options="characterOptions" @update:model-value="invalidateRegion(commentRegion!)" aria-label="浮动批注对应角色" /></label>
          <button class="btn primary small" @click="finishComment">完成批注</button>
        </div>
        </Transition>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ip-mask { position: fixed; inset: 0; z-index: 85; padding: calc(var(--titlebar-safe-height) + 24px) 24px 24px; display: grid; place-items: center; background: rgba(16,16,20,.42); backdrop-filter: blur(3px); }
.ip-dialog { position: relative; width: min(1220px, 100%); height: min(860px, 100%); display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--line2); border-radius: 18px; box-shadow: 0 24px 60px rgba(20,20,30,.22); overflow: hidden; }
.ip-marker { border-radius: 50%; width: 22px; height: 22px; background: var(--pink-soft); color: var(--pink-deep); font-size: 9px; font-weight: 600; border: 1px solid var(--pink-line); }
.ip-marker { position: absolute; transform: translate(-50%, -50%); box-shadow: 0 1px 5px #0003; cursor: pointer; }
.ip-mask-preview { pointer-events: none; }
.ip-close-confirm { display: flex; align-items: center; gap: 10px; padding: 9px 18px; border-top: 1px solid var(--line2); background: #fff4f4; color: #b4232a; font-size: 12.5px; }
.ip-close-confirm .danger { background: #e5484d; color: #fff; border-color: transparent; }
/* Keep a separate interaction/measurement surface; only the union is visible. */
.ip-active-mask { opacity: 0; }
.ip-tabs { margin-bottom: 12px; }
.ip-ai-section { display: flex; flex-direction: column; gap: 12px; }
.ip-ai-section .field-label, .ip-comment .field-label { display: flex; flex-direction: column; gap: 6px; }
.ip-context-menu { position: absolute; z-index: 6; width: 220px; padding: 6px; border: 1px solid var(--line2); border-radius: 12px; background: var(--bg); box-shadow: 0 10px 30px #0002; }
.ip-context-menu button { display: block; width: 100%; min-height: 34px; text-align: left; padding: 7px 10px; border-radius: 7px; font-size: 12px; }
.ip-context-menu button:hover { background: var(--pink-soft); }
.ip-comment.fade-leave-active, .ip-context-menu.fade-leave-active { pointer-events: none; }
.ip-annotation-item { border: 1px solid var(--line2); border-radius: 12px; padding: 10px; }
.ip-annotation-item > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
.ip-annotation-item > summary::before { content: '›'; color: var(--muted); }
.ip-annotation-item[open] > summary::before { transform: rotate(90deg); }
.ip-annotation-item > summary span { flex: 1; min-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text2); }
.ip-annotation-item > summary small { color: var(--muted); }
.ip-annotation-fields { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.ip-character-note summary { cursor: pointer; font-size: 12px; margin-bottom: 6px; }
.ip-annotation-fields .input.sm, .ip-comment .input.sm, .ip-ai-section > label .input.sm { width: 100%; max-width: none; }
.ip-annotation-fields :deep(.theme-select), .ip-comment :deep(.theme-select), .ip-ai-section > label :deep(.theme-select), .ip-param-grid :deep(.theme-select) { width: 100%; max-width: none; }
.ip-annotation { width: 100%; min-height: 120px; height: auto; padding: 10px; resize: none; line-height: 1.6; }
.ip-plan { border: 1px solid var(--line2); border-radius: 12px; padding: 10px; font-size: 12px; }
.ip-plan p { white-space: pre-wrap; line-height: 1.6; }
.ip-plan-warning { color: var(--alias); }
.ip-change { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.ip-change input { accent-color: var(--pink); }
.ip-change input:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--pink-line); }
.ip-full-change { color: var(--text2); }
.ip-full-change summary { cursor: pointer; font-size: 11px; }
.ip-full-change > div { margin-top: 8px; padding: 8px; background: var(--panel); border-radius: 7px; max-height: 260px; overflow: auto; overflow-wrap: anywhere; }
.ip-change :deep(.diff-row) { padding: 0; margin: 0; }
.ip-change :deep(.diff-chip) { max-width: 100%; height: auto; min-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ip-change small { color: var(--text2); line-height: 1.6; }
.ip-comment { max-height: calc(100% - 24px); overflow-y: auto; position: absolute; z-index: 5; width: 280px; display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--bg); border: 1px solid var(--pink-line); border-radius: 14px; box-shadow: 0 12px 40px #0003; }
.ip-head { display: flex; align-items: center; gap: 9px; padding: 13px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
.ip-head h3 { margin: 0; font-size: 15px; }
.ip-body { flex: 1; display: grid; grid-template-columns: minmax(0,1fr) 350px; min-height: 0; }
.ip-work { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 14px; gap: 10px; border-right: 1px solid var(--line); }
.ip-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ip-sliders { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; font-size: 11px; color: var(--text2); }
.ip-sliders .range { display: block; height: 20px; }
.ip-navigation { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ip-viewport { flex: 1; min-height: 120px; border: 1px solid var(--line2); border-radius: 12px; background: repeating-conic-gradient(#f1f1f4 0% 25%, #fafafb 0% 50%) 50% / 20px 20px; }
.ip-viewport canvas { touch-action: none; }
.ip-viewport canvas.locked { pointer-events: none; }
.ip-canvas-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 30px; font-size: 11.5px; color: var(--text2); }
.ip-canvas-foot i { display: inline-block; width: 8px; height: 8px; background: var(--pink); border-radius: 3px; margin-right: 4px; }
.ip-settings { padding: 16px; min-width: 0; scrollbar-gutter: stable; }
.ip-note { display: flex; align-items: flex-start; gap: 8px; padding: 10px; background: var(--pink-soft); border: 1px solid var(--pink-line); border-radius: 10px; font-size: 11.5px; line-height: 1.6; color: var(--text2); margin-bottom: 14px; }
.ip-note .icon { flex-shrink: 0; margin-top: 2px; color: var(--pink-deep); }
.ip-note span { display: block; color: var(--muted); }
.ip-note.plain { background: var(--panel); border-color: var(--line); margin: 14px 0 0; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.ip-analysis-details { font-size:11px;color:var(--muted);line-height:1.7;margin:10px 0; }.ip-analysis-details summary { cursor:pointer; }
.ip-textarea { display: block; width: 100%; resize: none; min-height: 100px; line-height: 1.55; font-size: 12px; margin: 6px 0 14px; }
.ip-negative { min-height: 64px; }
.ip-details { border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin-bottom: 14px; font-size: 12px; }
.ip-details summary { cursor: pointer; }
.ip-details summary span { display: block; font-size: 11px; margin-top: 4px; }
.ip-character { margin-top: 12px; }
.ip-strength { padding: 12px; background: var(--panel); border-radius: 10px; margin-bottom: 14px; font-size: 12px; }
.ip-strength label, .ip-scale-label { display: flex; justify-content: space-between; }
.ip-strength b { color: var(--pink-deep); font-family: var(--mono); }
.ip-scale-label { font-size: 11px; color: var(--muted); }
.ip-param-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11.5px; color: var(--text2); }
.ip-param-grid .input { display: block; width: 100%; margin-top: 5px; }
.ip-status { font-size: 12px; line-height: 1.6; padding-top: 12px; color: var(--text2); }
.ip-foot { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--line); }
@media (max-width: 1150px) { .ip-body { grid-template-columns: minmax(0,1fr) 310px; } .ip-mask { padding: calc(var(--titlebar-safe-height) + 16px) 16px 16px; } }
</style>
