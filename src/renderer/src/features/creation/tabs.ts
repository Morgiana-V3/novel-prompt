import type { AiPreviewResult } from '@shared/prompts/types'
import type { NaiImage } from '@shared/images/types'
import {
  computed,
  reactive,
  ref,
  shallowReactive,
  shallowRef,
  type Ref,
  type WritableComputedRef,
} from 'vue'
import { toast } from '../../shared/lib/notifications'
import {
  DEFAULT_PARAMS,
  promptState,
  toDrafts,
  type CharDraft,
  type FieldRef,
  type Snapshot,
  type WorkParams,
} from '../prompts/state'
import { DEFAULT_GEN, generationParams, imageState, type GenOnly } from '../generation/state'

/**
 * 生图创作的多标签页：每个标签是一份完全独立的创作（提示词、参数、历史、各分页的结果）。
 * 当前标签的内容就放在原来的全局状态里（promptState / generationParams / 各分页的 tabRef），
 * 其余标签只存快照；切换时整份换出、换入，所以各页面照常读写全局状态即可。
 */

/** 会写进本地存储的部分 */
interface TabContent {
  prompt: string
  negative: string
  characters: CharDraft[]
  params: WorkParams
  history: Snapshot[]
  gen: GenOnly
}

/** 只保留在本次运行中的部分（推测结果、预览图、各分页的结果） */
interface TabSession {
  lastPreview: { key: string; result: AiPreviewResult } | null
  focus: FieldRef
  currentImage: NaiImage | null
  view: ViewState
}

interface TabEntry {
  id: string
  /** 用户自己起的名字；为空时按主提示词自动显示 */
  title: string
  /** 非当前标签的快照；当前标签为 null（内容在全局状态里） */
  content: TabContent | null
  session: TabSession | null
}

type ViewState = Map<string, Ref<unknown>>

const TABS_KEY = 'np-creation-tabs-v1'
export const MAX_TABS = 10

interface PersistedTabs {
  activeId: string
  tabs: { id: string; title: string; content: TabContent | null }[]
}

/* ---------- 各分页的标签内状态 ---------- */

const registry = new Map<string, { init: () => unknown; shallow: boolean }>()
const activeView = shallowRef<ViewState>(new Map())

function makeRef(key: string, view: ViewState): Ref<unknown> {
  const entry = registry.get(key)!
  const value = entry.shallow ? shallowRef(entry.init()) : ref(entry.init())
  view.set(key, value)
  return value
}

/**
 * 跟随当前标签的 ref：用法和 ref 一样，但每个标签各存一份。
 * key 在全应用内唯一（建议「页面.字段」）；shallow 用于含函数或大对象、不需要深层响应的值。
 */
export function tabRef<T>(
  key: string,
  init: () => T,
  options: { shallow?: boolean } = {},
): WritableComputedRef<T> {
  if (!registry.has(key)) {
    registry.set(key, { init, shallow: !!options.shallow })
  }
  const slot = () => (activeView.value.get(key) ?? makeRef(key, activeView.value)) as Ref<T>
  slot()
  return computed({
    get: () => slot().value,
    set: (value: T) => {
      slot().value = value
    },
  })
}

/* ---------- 切换期间不能离开的任务 ---------- */

const locks = shallowReactive(new Set<() => string | false>())

/** 注册一个「正在进行、不能切换标签」的判断，返回原因或 false */
export function lockTabs(check: () => string | false): () => void {
  locks.add(check)
  return () => locks.delete(check)
}

function blocker(): string | false {
  if (imageState.generating) {
    return '正在生图'
  }
  for (const check of locks) {
    const reason = check()
    if (reason) {
      return reason
    }
  }
  return false
}

/* ---------- 快照 ---------- */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function blankContent(): TabContent {
  return {
    prompt: '',
    negative: '',
    characters: [],
    params: { ...DEFAULT_PARAMS },
    history: [],
    gen: { ...DEFAULT_GEN, seed: null },
  }
}

function blankSession(): TabSession {
  return { lastPreview: null, focus: { kind: 'base' }, currentImage: null, view: new Map() }
}

function capture(): { content: TabContent; session: TabSession } {
  return {
    content: clone({
      prompt: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters,
      params: promptState.params,
      history: promptState.history,
      gen: generationParams,
    }),
    session: {
      lastPreview: promptState.lastPreview,
      focus: { ...promptState.focus },
      currentImage: imageState.currentImage,
      view: activeView.value,
    },
  }
}

function restore(content: TabContent, session: TabSession): void {
  promptState.prompt = content.prompt
  promptState.negative = content.negative
  promptState.characters = toDrafts(content.characters)
  // 有页面在 setup 时持有 promptState.params / generationParams 的引用，只能原地改
  Object.assign(promptState.params, { ...DEFAULT_PARAMS, ...content.params })
  Object.assign(generationParams, { ...DEFAULT_GEN, ...content.gen })
  promptState.history = content.history
  promptState.lastPreview = session.lastPreview
  promptState.focus = session.focus
  imageState.currentImage = session.currentImage
  for (const key of registry.keys()) {
    if (!session.view.has(key)) {
      makeRef(key, session.view)
    }
  }
  activeView.value = session.view
}

const hasContent = (content: TabContent) =>
  !!(
    content.prompt.trim() ||
    content.negative.trim() ||
    content.characters.some((character) => character.prompt.trim() || character.negative.trim())
  )

/* ---------- 标签列表 ---------- */

let seq = 0
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

function loadTabs(): { activeId: string; list: TabEntry[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null') as PersistedTabs | null
    if (saved?.tabs?.some((tab) => tab.id === saved.activeId)) {
      return {
        activeId: saved.activeId,
        list: saved.tabs.map((tab) => ({
          id: tab.id,
          title: tab.title ?? '',
          // 当前标签的内容沿用原来的存储（np-workspace-v1 / np-gen-params）
          content: tab.id === saved.activeId ? null : { ...blankContent(), ...tab.content },
          session: null,
        })),
      }
    }
  } catch {
    // 损坏时退回单个标签
  }
  // 首次使用：现有的提示词成为第一个标签
  const id = newId()
  return { activeId: id, list: [{ id, title: '', content: null, session: null }] }
}

const initial = loadTabs()

export const creationTabs = reactive({
  activeId: initial.activeId,
  list: initial.list,
})

function saveTabs(): void {
  const data: PersistedTabs = {
    activeId: creationTabs.activeId,
    tabs: creationTabs.list.map((tab) => ({
      id: tab.id,
      title: tab.title,
      content: tab.id === creationTabs.activeId ? null : tab.content,
    })),
  }
  localStorage.setItem(TABS_KEY, JSON.stringify(data))
}

const activeEntry = () => creationTabs.list.find((tab) => tab.id === creationTabs.activeId)!

function leaveActive(): boolean {
  const reason = blocker()
  if (reason) {
    toast(`${reason}，完成后再切换标签`)
    return false
  }
  const entry = activeEntry()
  const snap = capture()
  entry.content = snap.content
  entry.session = snap.session
  return true
}

function enter(entry: TabEntry): void {
  restore(entry.content ?? blankContent(), entry.session ?? blankSession())
  entry.content = null
  entry.session = null
  creationTabs.activeId = entry.id
  saveTabs()
}

export function switchTab(id: string): void {
  const target = creationTabs.list.find((tab) => tab.id === id)
  if (!target || id === creationTabs.activeId || !leaveActive()) {
    return
  }
  enter(target)
}

/** 新建一个空白标签（提示词、参数、历史全部从默认开始），成功时返回 true */
export function createTab(title = ''): boolean {
  if (creationTabs.list.length >= MAX_TABS) {
    toast(`最多同时打开 ${MAX_TABS} 个标签，请先关闭不用的标签`)
    return false
  }
  if (!leaveActive()) {
    return false
  }
  const index = creationTabs.list.findIndex((tab) => tab.id === creationTabs.activeId)
  const entry: TabEntry = { id: newId(), title, content: null, session: null }
  creationTabs.list.splice(index + 1, 0, entry)
  enter(creationTabs.list[index + 1])
  return true
}

/**
 * 图集、收藏、反推等外部入口载入配置前调用：不覆盖正在编辑的内容。
 * 当前标签还是空白就直接用它，否则新开一个标签承接；返回 false 表示这次不能载入。
 */
export function openTabForLoad(title = ''): boolean {
  const live: TabContent = { ...blankContent(), ...capture().content }
  if (hasContent(live)) {
    return createTab(title && uniqueTitle(title))
  }
  const reason = blocker()
  if (reason) {
    toast(`${reason}，完成后再载入`)
    return false
  }
  if (title) {
    activeEntry().title = uniqueTitle(title, creationTabs.activeId)
    saveTabs()
  }
  return true
}

/** 同名标签自动加序号，例如多次载入同一个收藏：灰衣配方、灰衣配方 (2)… */
function uniqueTitle(title: string, exceptId?: string): string {
  const base = title.trim().slice(0, 36)
  const used = new Set(
    creationTabs.list.filter((tab) => tab.id !== exceptId).map((tab) => tabTitle(tab)),
  )
  if (!used.has(base)) {
    return base
  }
  let n = 2
  while (used.has(`${base} (${n})`)) {
    n++
  }
  return `${base} (${n})`
}

export function closeTab(id: string): void {
  if (creationTabs.list.length <= 1) {
    return
  }
  const index = creationTabs.list.findIndex((tab) => tab.id === id)
  if (index < 0) {
    return
  }
  if (id === creationTabs.activeId) {
    if (!leaveActive()) {
      return
    }
    const next = creationTabs.list[index + 1] ?? creationTabs.list[index - 1]
    enter(next)
  }
  const [removed] = creationTabs.list.splice(index, 1)
  saveTabs()
  if (removed.content && hasContent(removed.content)) {
    toast(`已关闭「${tabTitle(removed)}」`, {
      label: '撤销',
      run: () => {
        if (creationTabs.list.length >= MAX_TABS) {
          toast(`最多同时打开 ${MAX_TABS} 个标签`)
          return
        }
        creationTabs.list.splice(Math.min(index, creationTabs.list.length), 0, removed)
        switchTab(removed.id)
        saveTabs()
      },
    })
  }
}

export function renameTab(id: string, title: string): void {
  const entry = creationTabs.list.find((tab) => tab.id === id)
  if (entry) {
    entry.title = title.trim().slice(0, 40)
    saveTabs()
  }
}

/** 标签上显示的名字：自定义名称 > 主提示词开头 > 第一个角色 > 「新标签」 */
export function tabTitle(entry: TabEntry): string {
  if (entry.title) {
    return entry.title
  }
  const content = entry.content
  const base = content ? content.prompt : promptState.prompt
  const characters = content ? content.characters : promptState.characters
  const text =
    base.trim() || characters.find((character) => character.prompt.trim())?.prompt.trim() || ''
  const first = text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .find(Boolean)
  return first ? first.slice(0, 18) : '新标签'
}

export const tabsLocked = computed(() => !!blocker())
