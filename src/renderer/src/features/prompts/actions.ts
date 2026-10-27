import type { ImportedPrompt } from '@shared/prompts/import'
import type { TagCategory } from '@shared/tags/types'
import { watch } from 'vue'
import { toast } from '../../shared/lib/notifications'
import { settingsState } from '../settings/state'
import type { FieldRef, Persisted, Snapshot } from './state'
import { MAX_HISTORY, promptState, STORE_KEY, toDrafts } from './state'

export let saveTimer: ReturnType<typeof setTimeout> | undefined

export function flushWorkspace(): void {
  clearTimeout(saveTimer)
  const data: Persisted = {
    prompt: promptState.prompt,
    negative: promptState.negative,
    characters: promptState.characters,
    params: promptState.params,
    history: promptState.history,
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(data))
}

export function startPromptPersistence() {
  watch(
    () => [
      promptState.prompt,
      promptState.negative,
      promptState.characters,
      promptState.params,
      promptState.history,
    ],
    () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flushWorkspace, 300)
    },
    { deep: true },
  )
}

/* ---------- 输入框读写 ---------- */

export function validField(field: FieldRef): boolean {
  return field.kind !== 'char' || field.index < promptState.characters.length
}

export function readField(field: FieldRef): string {
  if (field.kind === 'base') {
    return promptState.prompt
  }
  if (field.kind === 'negative') {
    return promptState.negative
  }
  const character = promptState.characters[field.index]
  if (character) {
    if (field.neg) {
      return character.negative
    }
    return character.prompt
  }
  return '' as const
}

export function writeField(field: FieldRef, text: string): void {
  if (field.kind === 'base') {
    promptState.prompt = text
  } else if (field.kind === 'negative') {
    promptState.negative = text
  } else {
    const character = promptState.characters[field.index]
    if (!character) {
      return
    }
    if (field.neg) {
      character.negative = text
    } else {
      character.prompt = text
    }
  }
}

export function fieldLabel(field: FieldRef): string {
  if (field.kind === 'base') {
    return '主提示词'
  }
  if (field.kind === 'negative') {
    return '负面'
  }
  return `角色 ${field.index + 1}${field.neg ? ' 负面' : ''}`
}

export const sameField = (field: FieldRef, field2: FieldRef) =>
  field.kind === field2.kind &&
  (field.kind !== 'char' ||
    (field2.kind === 'char' && field.index === field2.index && !!field.neg === !!field2.neg))

/** 当前提示词里所有的输入框，按显示顺序 */
export function fieldList(includeCharNeg = true): FieldRef[] {
  const out: FieldRef[] = [{ kind: 'base' }]
  promptState.characters.forEach((character, index) => {
    out.push({ kind: 'char', index })
    if (includeCharNeg) {
      out.push({ kind: 'char', index, neg: true })
    }
  })
  out.push({ kind: 'negative' })
  return out
}

/** 往最近编辑的输入框末尾追加 tag */
export function appendTag(display: string, category: TagCategory): void {
  const tag = category === 1 ? `artist:${display}` : display
  const field = validField(promptState.focus) ? promptState.focus : ({ kind: 'base' } as FieldRef)
  const path = readField(field).replace(/[\s,]+$/, '')
  writeField(field, path ? `${path}, ${tag}` : tag)
  toast(`已添加到「${fieldLabel(field)}」：${tag}`)
}

/* ---------- 整体替换与历史 ---------- */

export const isEmpty = () =>
  !promptState.prompt.trim() &&
  !promptState.negative.trim() &&
  !promptState.characters.some((character) => character.prompt.trim() || character.negative.trim())

export function contentKey(snapshot: Pick<Snapshot, 'base' | 'negative' | 'characters'>): string {
  return JSON.stringify([
    snapshot.base.trim(),
    snapshot.negative.trim(),
    snapshot.characters.map((character) => [
      character.prompt.trim(),
      character.negative.trim(),
      character.position.trim(),
    ]),
  ])
}

export function current(label: string): Snapshot {
  return {
    base: promptState.prompt,
    negative: promptState.negative,
    characters: promptState.characters.map((character) => ({ ...character })),
    label,
    at: Date.now(),
  }
}

/** 把当前内容存进历史（空内容时跳过，与最近一条相同时复用那一条），返回对应的历史条目 */
export function pushHistory(label: string): Snapshot | null {
  if (isEmpty()) {
    return null
  }
  const snap = current(label)
  if (promptState.history[0] && contentKey(promptState.history[0]) === contentKey(snap)) {
    return promptState.history[0]
  }
  promptState.history.unshift(snap)
  if (promptState.history.length > MAX_HISTORY) {
    promptState.history.length = MAX_HISTORY
  }
  return promptState.history[0]
}

export function setContent(promptSnapshot: {
  base: string
  negative: string
  characters: { prompt: string; negative?: string; position?: string }[]
}) {
  promptState.prompt = promptSnapshot.base
  promptState.negative = promptSnapshot.negative
  promptState.characters = toDrafts(promptSnapshot.characters)
  if (!validField(promptState.focus)) {
    promptState.focus = { kind: 'base' }
  }
}

/** 整体替换当前提示词，替换前自动存一份历史；返回替换前的历史条目（替换前为空时为 null） */
export function applyWorkspace(
  promptSnapshot: {
    base: string
    negative: string
    characters: { prompt: string; negative?: string; position?: string }[]
  },
  label: string,
): Snapshot | null {
  const before = pushHistory(label)
  setContent(promptSnapshot)
  return before
}

/**
 * 回到指定的历史条目（例如「撤销采用」回到采用前那一份），而不是盲目弹出栈顶。
 * 当前内容先存进历史，撤销本身也能再找回。before 为 null 表示替换前是空白。
 */
export function revertTo(before: Snapshot | null, label: string): boolean {
  const index = before
    ? promptState.history.findIndex(
        (character) => character.at === before.at && character.label === before.label,
      )
    : -1
  if (before && index < 0) {
    toast('替换前的版本已不在历史里（最多保留 30 条），请从「历史版本」中选择')
    return false
  }
  const target = before ? promptState.history[index] : null
  pushHistory(label)
  if (target) {
    promptState.history.splice(promptState.history.indexOf(target), 1)
    setContent(target)
    toast(`已恢复到「${target.label}」的版本，撤销前的内容已存进历史`)
  } else {
    setContent({ base: '', negative: '', characters: [] })
    toast('已恢复为空白，撤销前的内容已存进历史')
  }
  return true
}

/** 删除一个角色：有内容时先存历史，并在提示条上提供撤销 */
export function removeCharacter(i: number): void {
  const character = promptState.characters[i]
  if (!character) {
    return
  }
  const hasContent = !!(
    character.prompt.trim() ||
    character.negative.trim() ||
    character.position.trim()
  )
  if (hasContent) {
    pushHistory('删除角色前')
  }
  const [removed] = promptState.characters.splice(i, 1)
  if (promptState.focus.kind === 'char') {
    promptState.focus = { kind: 'base' }
  }
  if (!hasContent) {
    return
  }
  toast(`已删除角色 ${i + 1}`, {
    label: '撤销',
    run: () => {
      promptState.characters.splice(Math.min(i, promptState.characters.length), 0, removed)
      toast(`已恢复角色 ${i + 1}`)
    },
  })
}

/** 撤销最近一次整体替换 */
export function undoWorkspace(): boolean {
  const character = promptState.history.shift()
  if (!character) {
    return false
  }
  setContent(character)
  toast(`已恢复到「${character.label}」的版本`)
  return true
}

/** 恢复到某个历史版本（当前内容也会先存进历史，不会丢） */
export function restoreHistory(i: number): void {
  const character = promptState.history[i]
  if (!character) {
    return
  }
  pushHistory('恢复历史前')
  setContent(character)
  toast('已恢复')
}

export function clearWorkspace(): void {
  if (isEmpty()) {
    return
  }
  pushHistory('清空前')
  setContent({ base: '', negative: '', characters: [] })
  toast('已清空，可在历史里找回')
}

/** 导入一整套提示词（分节文本 / 元数据 / 原图） */
export function importPrompt(importedPrompt: ImportedPrompt, source: string): void {
  applyWorkspace(importedPrompt, '导入前')
  const before = { ...promptState.params }
  const changed: string[] = []
  if (
    importedPrompt.width &&
    importedPrompt.height &&
    (importedPrompt.width !== before.width || importedPrompt.height !== before.height)
  ) {
    promptState.params.width = importedPrompt.width
    promptState.params.height = importedPrompt.height
    changed.push(`画幅改为 ${importedPrompt.width}×${importedPrompt.height}`)
  }
  // 元数据里的提示词已经包含质量词和 UC 预设，避免重复追加
  if (importedPrompt.fromMetadata) {
    if (before.qualityTags) {
      changed.push('关闭质量词')
    }
    if (before.ucPreset !== 'none') {
      changed.push('UC 预设改为无')
    }
    promptState.params.qualityTags = false
    promptState.params.ucPreset = 'none'
  }
  const parts = [
    importedPrompt.base && '主提示词',
    importedPrompt.characters.length && `${importedPrompt.characters.length} 个角色`,
    importedPrompt.negative && '负面',
  ].filter(Boolean)
  const head = parts.length ? `${source}：${parts.join(' / ')}` : '没有识别到提示词'
  if (!changed.length) {
    return toast(head)
  }
  // 参数会一直保存下去并影响之后的推测和生图，必须明确告诉用户并允许恢复
  const reason =
    importedPrompt.fromMetadata && (before.qualityTags || before.ucPreset !== 'none')
      ? '（原图提示词已包含质量词和预设）'
      : ''
  toast(`${head}。已${changed.join('、')}${reason}`, {
    label: '恢复原参数',
    run: () => {
      Object.assign(promptState.params, before)
      toast('已恢复导入前的画幅、质量词和 UC 预设')
    },
  })
}

/** 当前提示词 + 共用参数 + 模型版本的指纹：用来判断推测结果是否过期、图片对应哪次推测 */
export function workKey(): string {
  const parameters = promptState.params
  return JSON.stringify([
    contentKey({
      base: promptState.prompt,
      negative: promptState.negative,
      characters: promptState.characters.filter((character) => character.prompt.trim()),
    }),
    parameters.width,
    parameters.height,
    parameters.qualityTags,
    parameters.ucPreset,
    settingsState.settings?.naiVersion,
  ])
}

/** 导出为分节文本（与导入格式互通） */
export function sectionText(promptSnapshot: {
  base: string
  negative: string
  characters: { prompt: string; negative?: string; position?: string }[]
}): string {
  const parts = [`[Prompt]\n${promptSnapshot.base}`]
  promptSnapshot.characters.forEach((character, i) => {
    if (!character.prompt.trim()) {
      return
    }
    parts.push(
      `[Character ${i + 1}${character.position?.trim() ? ' @ ' + character.position.trim() : ''}]\n${character.prompt}`,
    )
    if (character.negative?.trim()) {
      parts.push(`[Character ${i + 1} Undesired Content]\n${character.negative}`)
    }
  })
  if (promptSnapshot.negative.trim()) {
    parts.push(`[Undesired Content]\n${promptSnapshot.negative}`)
  }
  return parts.join('\n\n')
}

startPromptPersistence()
