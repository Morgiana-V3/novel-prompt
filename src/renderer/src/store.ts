import { reactive, watch } from 'vue'
import type { AiPreviewResult, DbStatus, NaiImage, Settings, SkillConfigItem, TagCategory, UcPreset, UpdateInfo, UpdateProgress } from '@shared/types'
import type { ImportedPrompt } from '@shared/prompt-import'

export const CAT_CLASS: Record<TagCategory, string> = {
  0: 'cat-general',
  1: 'cat-artist',
  3: 'cat-copyright',
  4: 'cat-character',
  5: 'cat-meta',
  100: 'cat-nai'
}

/** 输入框里的角色提示词（字段都是字符串，便于 v-model） */
export interface CharDraft {
  prompt: string
  negative: string
  position: string
}

export const toDrafts = (list: { prompt: string; negative?: string; position?: string }[]): CharDraft[] =>
  list.map((c) => ({ prompt: c.prompt ?? '', negative: c.negative ?? '', position: c.position ?? '' }))

/** 推测和生图共用的参数：两边必须一致，推测结果才能和实际出图对得上 */
export interface WorkParams {
  width: number
  height: number
  /** Add Quality Tags */
  qualityTags: boolean
  ucPreset: UcPreset
}

/** 当前提示词中的某个输入框 */
export type FieldRef = { kind: 'base' } | { kind: 'negative' } | { kind: 'char'; index: number; neg?: boolean }

export interface Snapshot {
  base: string
  negative: string
  characters: CharDraft[]
  /** 这份快照是在什么操作之前保存的 */
  label: string
  at: number
}

export type Tab = 'compare' | 'ai' | 'preview' | 'generate' | 'workspace' | 'search' | 'settings'

const STORE_KEY = 'np-workspace-v1'
const MAX_HISTORY = 30

export const DEFAULT_PARAMS: Readonly<WorkParams> = { width: 832, height: 1216, qualityTags: true, ucPreset: 'heavy' }

interface Persisted {
  prompt?: string
  negative?: string
  characters?: CharDraft[]
  params?: Partial<WorkParams>
  history?: Snapshot[]
}

function load(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Persisted
  } catch {
    return {}
  }
}
const saved = load()

export const state = reactive({
  tab: 'compare' as Tab,
  /* ---- 当前提示词：所有页面共用，自动保存 ---- */
  prompt: saved.prompt ?? '',
  negative: saved.negative ?? '',
  characters: toDrafts(saved.characters ?? []),
  params: { ...DEFAULT_PARAMS, ...saved.params } as WorkParams,
  history: (saved.history ?? []) as Snapshot[],
  /** 最近编辑的输入框，Tag 搜索会把 tag 加到这里 */
  focus: { kind: 'base' } as FieldRef,
  /** 最近一次画面推测（key = 推测时的提示词与参数） */
  lastPreview: null as { key: string; result: AiPreviewResult } | null,
  /** 生成的图片 → 生成时的提示词 key，用于和推测结果对照 */
  imageKeys: {} as Record<string, string>,
  /** 生图预览当前选中的图片，也是各页面角色位置编辑器的参考底图；仅保留在本次会话 */
  currentImage: null as NaiImage | null,
  positionReference: { visible: true, opacity: 40 },
  /** 生图预览送入新建会话的图片，只暂存，不自动创建记录。 */
  workspaceImage: null as NaiImage | null,

  settings: null as Settings | null,
  /** 全部 Skill，按优先级排列，含启用状态 */
  skills: [] as SkillConfigItem[],
  /** 侧栏的 Skill 启用浮层是否打开 */
  skillPanel: false,
  /** 切到设置页后滚动到的区块 id */
  settingsAnchor: '',
  db: null as DbStatus | null,
  progress: null as UpdateProgress | null,
  /** 版本检查结果（发现新版时侧栏提示） */
  update: null as UpdateInfo | null,
  /** 用户关掉了这次的更新提示 */
  updateDismissed: false,
  toast: ''
})

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [state.prompt, state.negative, state.characters, state.params, state.history],
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const data: Persisted = {
        prompt: state.prompt,
        negative: state.negative,
        characters: state.characters,
        params: state.params,
        history: state.history
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(data))
    }, 300)
  },
  { deep: true }
)

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string): void {
  state.toast = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (state.toast = ''), 1800)
}

export async function copy(text: string): Promise<void> {
  await window.api.copy(text)
  toast('已复制')
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export const cleanErr = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/^(Error: )?(Error invoking remote method '[^']+': )?(Error: )?/, '')

/* ---------- Skill ---------- */

/** 重新读取 Skill 列表（启用状态与优先级）；MCP 可能在后台改过，打开相关界面时调用 */
export async function loadSkills(): Promise<SkillConfigItem[]> {
  state.skills = await window.api.skillsList()
  return state.skills
}

/** 保存启用与优先级（传入完整列表，顺序即优先级） */
export async function saveSkillConfig(list: SkillConfigItem[]): Promise<void> {
  state.skills = list
  state.skills = await window.api.skillsSetConfig(list.map((s) => ({ id: s.id, enabled: s.enabled })))
}

/* ---------- 输入框读写 ---------- */

export function validField(f: FieldRef): boolean {
  return f.kind !== 'char' || f.index < state.characters.length
}

export function readField(f: FieldRef): string {
  if (f.kind === 'base') return state.prompt
  if (f.kind === 'negative') return state.negative
  const c = state.characters[f.index]
  return c ? (f.neg ? c.negative : c.prompt) : ''
}

export function writeField(f: FieldRef, v: string): void {
  if (f.kind === 'base') state.prompt = v
  else if (f.kind === 'negative') state.negative = v
  else {
    const c = state.characters[f.index]
    if (!c) return
    if (f.neg) c.negative = v
    else c.prompt = v
  }
}

export function fieldLabel(f: FieldRef): string {
  if (f.kind === 'base') return '主提示词'
  if (f.kind === 'negative') return '负面'
  return `角色 ${f.index + 1}${f.neg ? ' 负面' : ''}`
}

export const sameField = (a: FieldRef, b: FieldRef) =>
  a.kind === b.kind && (a.kind !== 'char' || (b.kind === 'char' && a.index === b.index && !!a.neg === !!b.neg))

/** 当前提示词里所有的输入框，按显示顺序 */
export function fieldList(includeCharNeg = true): FieldRef[] {
  const out: FieldRef[] = [{ kind: 'base' }]
  state.characters.forEach((c, index) => {
    out.push({ kind: 'char', index })
    if (includeCharNeg) out.push({ kind: 'char', index, neg: true })
  })
  out.push({ kind: 'negative' })
  return out
}

/** 往最近编辑的输入框末尾追加 tag */
export function appendTag(display: string, category: TagCategory): void {
  const tag = category === 1 ? `artist:${display}` : display
  const f = validField(state.focus) ? state.focus : ({ kind: 'base' } as FieldRef)
  const p = readField(f).replace(/[\s,]+$/, '')
  writeField(f, p ? `${p}, ${tag}` : tag)
  toast(`已添加到「${fieldLabel(f)}」：${tag}`)
}

/* ---------- 整体替换与历史 ---------- */

const isEmpty = () => !state.prompt.trim() && !state.negative.trim() && !state.characters.some((c) => c.prompt.trim() || c.negative.trim())

function contentKey(s: Pick<Snapshot, 'base' | 'negative' | 'characters'>): string {
  return JSON.stringify([s.base.trim(), s.negative.trim(), s.characters.map((c) => [c.prompt.trim(), c.negative.trim(), c.position.trim()])])
}

function current(label: string): Snapshot {
  return { base: state.prompt, negative: state.negative, characters: state.characters.map((c) => ({ ...c })), label, at: Date.now() }
}

/** 把当前内容存进历史（空内容、与最近一条相同时跳过） */
export function pushHistory(label: string): void {
  if (isEmpty()) return
  const snap = current(label)
  if (state.history[0] && contentKey(state.history[0]) === contentKey(snap)) return
  state.history.unshift(snap)
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY
}

function setContent(p: { base: string; negative: string; characters: { prompt: string; negative?: string; position?: string }[] }) {
  state.prompt = p.base
  state.negative = p.negative
  state.characters = toDrafts(p.characters)
  if (!validField(state.focus)) state.focus = { kind: 'base' }
}

/** 整体替换当前提示词，替换前自动存一份历史 */
export function applyWorkspace(
  p: { base: string; negative: string; characters: { prompt: string; negative?: string; position?: string }[] },
  label: string
): void {
  pushHistory(label)
  setContent(p)
}

/** 撤销最近一次整体替换 */
export function undoWorkspace(): boolean {
  const s = state.history.shift()
  if (!s) return false
  setContent(s)
  toast(`已恢复到「${s.label}」的版本`)
  return true
}

/** 恢复到某个历史版本（当前内容也会先存进历史，不会丢） */
export function restoreHistory(i: number): void {
  const s = state.history[i]
  if (!s) return
  pushHistory('恢复历史前')
  setContent(s)
  toast('已恢复')
}

export function clearWorkspace(): void {
  if (isEmpty()) return
  pushHistory('清空前')
  setContent({ base: '', negative: '', characters: [] })
  toast('已清空，可在历史里找回')
}

/** 导入一整套提示词（分节文本 / 元数据 / 原图） */
export function importPrompt(r: ImportedPrompt, source: string): void {
  applyWorkspace(r, '导入前')
  if (r.width && r.height) {
    state.params.width = r.width
    state.params.height = r.height
  }
  // 元数据里的提示词已经包含质量词和 UC 预设，避免重复追加
  if (r.fromMetadata) {
    state.params.qualityTags = false
    state.params.ucPreset = 'none'
  }
  const parts = [r.base && '主提示词', r.characters.length && `${r.characters.length} 个角色`, r.negative && '负面'].filter(Boolean)
  toast(parts.length ? `${source}：${parts.join(' / ')}` : '没有识别到提示词')
}

/** 当前提示词 + 共用参数 + 模型版本的指纹：用来判断推测结果是否过期、图片对应哪次推测 */
export function workKey(): string {
  const p = state.params
  return JSON.stringify([
    contentKey({ base: state.prompt, negative: state.negative, characters: state.characters.filter((c) => c.prompt.trim()) }),
    p.width,
    p.height,
    p.qualityTags,
    p.ucPreset,
    state.settings?.naiVersion
  ])
}

/** 导出为分节文本（与导入格式互通） */
export function sectionText(p: {
  base: string
  negative: string
  characters: { prompt: string; negative?: string; position?: string }[]
}): string {
  const parts = [`[Prompt]\n${p.base}`]
  p.characters.forEach((c, i) => {
    if (!c.prompt.trim()) return
    parts.push(`[Character ${i + 1}${c.position?.trim() ? ' @ ' + c.position.trim() : ''}]\n${c.prompt}`)
    if (c.negative?.trim()) parts.push(`[Character ${i + 1} Undesired Content]\n${c.negative}`)
  })
  if (p.negative.trim()) parts.push(`[Undesired Content]\n${p.negative}`)
  return parts.join('\n\n')
}

export async function refreshDb(): Promise<void> {
  state.db = await window.api.dbStatus()
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  state.settings = await window.api.saveSettings(patch)
}

/* ---------- 版本检查 ---------- */

/**
 * 启动后异步查一次（有 24 小时缓存，不会每次都请求）。失败静默，不打扰用户。
 * force = 用户手动点「检查更新」。
 */
export async function checkUpdate(force = false): Promise<void> {
  try {
    state.update = await window.api.checkUpdate(force)
    // 新版本号变了就重新允许提示（用户之前关掉的是旧的那次提示）
    if (force) state.updateDismissed = false
  } catch {
    /* 忽略：检查更新失败不影响任何功能 */
  }
}

export function dismissUpdate(): void {
  state.updateDismissed = true
}
