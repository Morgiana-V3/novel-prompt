import { tagCompletionLimit } from '@shared/settings/tag-completion'
import { settingsState } from '../settings/state'
import type { SearchHit, TagCategory } from '@shared/tags/types'
import { CAT_CLASS } from '../tags/state'
import { fmtCount } from '../../shared/lib/format'

/**
 * 输入 / 开启一次 Tag 快捷搜索，空格属于查询；选中后仅替换 / 和查询文字。
 * 同时保留普通输入自动补全；显式搜索优先。Esc、失焦或移出范围结束当前提示。
 */

const DEBOUNCE = 120
const ZH = /[\u4e00-\u9fff]/

/** 候选项：insert 替换整个搜索范围，不附加分隔符 */
interface Item {
  insert: string
  name: string
  note: string
  count: string
  cls: string
  syntax: boolean
}

/** NovelAI 常用写法，按英文或中文关键词的前缀匹配 */
const SYNTAX: { insert: string; note: string; keys: string[] }[] = [
  { insert: 'artist:', note: '画师', keys: ['artist', '画师'] },
  { insert: 'Text: ', note: '画面文字', keys: ['text', '文字'] },
  { insert: 'source#', note: '动作发起方', keys: ['source', '发起'] },
  { insert: 'target#', note: '动作承受方', keys: ['target', '承受'] },
  { insert: 'mutual#', note: '双方互相', keys: ['mutual', '互相'] },
]
/** 带前缀的 tag：前缀之后照常补全，artist: 只查画师 */
const PREFIXED = /^(artist:|source#|target#|mutual#)\s*(.*)$/i
const PREFIX_CATEGORY: Record<string, TagCategory | undefined> = { 'artist:': 1 }

function syntaxItems(text: string): Item[] {
  const query = text.trim().toLowerCase()
  if (!ZH.test(query) && query.length < 2) {
    return []
  }
  return SYNTAX.filter((rule) => rule.keys.some((key) => key.startsWith(query))).map((rule) => ({
    insert: rule.insert,
    name: rule.insert.trim(),
    note: rule.note,
    count: '语法',
    cls: 'syntax',
    syntax: true,
  }))
}

function tagItem(hit: SearchHit, prefix: string): Item {
  return {
    insert: prefix + hit.display,
    name: prefix + hit.display,
    note: hit.viaAlias ? `${hit.viaAlias} →` : (hit.zh ?? ''),
    count: hit.count ? fmtCount(hit.count) : '',
    cls: CAT_CLASS[hit.category] ?? '',
    syntax: false,
  }
}

interface Token {
  start: number
  end: number
  text: string
}

/** 光标所在的 tag：从上一个分隔符到光标，跳过权重前缀和括号；光标必须在这个 tag 的末尾 */
function automaticToken(el: HTMLTextAreaElement): Token | null {
  const caret = el.selectionStart
  if (caret !== el.selectionEnd) {
    return null
  }
  const next = el.value[caret]
  if (next && !/[\s,|)\]}]/.test(next)) {
    return null
  }
  const before = el.value.slice(0, caret)
  const start =
    Math.max(before.lastIndexOf(','), before.lastIndexOf('\n'), before.lastIndexOf('|')) + 1
  const raw = before.slice(start)
  const lead = /^\s*(?:-?\d*\.?\d+::)?[{[(]*/.exec(raw)?.[0].length ?? 0
  const text = raw.slice(lead)
  // Text: 之后是画面里的文字，不做补全
  if (
    !text ||
    /[/\\]/.test(text) ||
    /^text:/i.test(text) ||
    text.length > 40 ||
    /::|[{}[\]().!?。！？]/.test(text) ||
    text.trim().split(/\s+/).length > 4 ||
    (!ZH.test(text) && text.trim().length < 2)
  ) {
    return null
  }
  return { start: start + lead, end: caret, text }
}

/** 用一个隐藏的镜像元素量出光标在页面上的位置 */
function caretRect(el: HTMLTextAreaElement, position: number) {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const property of [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
  ] as const) {
    mirror.style[property] = style[property]
  }
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  })
  mirror.textContent = el.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.append(marker)
  document.body.append(mirror)
  const box = el.getBoundingClientRect()
  const left = box.left + marker.offsetLeft - el.scrollLeft
  const top = box.top + marker.offsetTop - el.scrollTop
  const height = parseFloat(style.lineHeight) || marker.offsetHeight
  mirror.remove()
  return { left, top, bottom: top + height }
}

class Completion {
  private popup: HTMLDivElement | null = null
  private items: Item[] = []
  private active = 0
  private token: Token | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private request = 0
  private session: { prefix: string; suffix: string } | null = null
  private composing = false
  private message = ''
  private automatic = false
  private inserting = false

  private currentToken(): Token | null {
    const session = this.session
    if (this.el.readOnly) {
      return null
    }
    if (!session) {
      return this.automatic ? automaticToken(this.el) : null
    }
    const { value, selectionStart, selectionEnd } = this.el
    const start = session.prefix.length
    const end = value.length - session.suffix.length
    if (
      !value.startsWith(session.prefix + '/') ||
      !value.endsWith(session.suffix) ||
      selectionStart < start + 1 ||
      selectionEnd > end ||
      end < start + 1
    ) {
      return null
    }
    const text = value.slice(start + 1, end)
    if (/[\r\n/]/.test(text)) {
      return null
    }
    return { start, end, text }
  }

  private onSelection = () => {
    const current = this.currentToken()
    if (
      (this.session || this.automatic) &&
      (!current ||
        (this.token &&
          (current.start !== this.token.start ||
            current.end !== this.token.end ||
            current.text !== this.token.text)))
    ) {
      this.close()
    }
  }

  private onCompositionStart = () => {
    this.composing = true
    this.hide()
  }

  private onCompositionEnd = () => {
    this.composing = false
    this.onInput(new Event('input'))
  }

  constructor(private el: HTMLTextAreaElement) {
    el.addEventListener('input', this.onInput)
    el.addEventListener('keydown', this.onKeydown, true)
    el.addEventListener('blur', this.onBlur)
    el.addEventListener('scroll', this.close)
    el.addEventListener('select', this.onSelection)
    el.addEventListener('compositionstart', this.onCompositionStart)
    el.addEventListener('compositionend', this.onCompositionEnd)
    document.addEventListener('selectionchange', this.onSelection)
  }

  dispose() {
    this.el.removeEventListener('input', this.onInput)
    this.el.removeEventListener('keydown', this.onKeydown, true)
    this.el.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('scroll', this.close)
    this.el.removeEventListener('select', this.onSelection)
    this.el.removeEventListener('compositionstart', this.onCompositionStart)
    this.el.removeEventListener('compositionend', this.onCompositionEnd)
    document.removeEventListener('selectionchange', this.onSelection)
    this.close()
  }

  private onInput = (event: Event) => {
    this.hide()
    const input = event as InputEvent
    if (this.el.readOnly || this.inserting || /^(history|insertFrom)/.test(input.inputType ?? '')) {
      this.close()
      return
    }
    if (input.isComposing || this.composing) {
      return
    }
    // Only an explicitly typed slash starts a session, never a pasted URL/path.
    if (input.inputType === 'insertText' && input.data === '/') {
      const caret = this.el.selectionStart
      const before = this.el.value.slice(0, caret - 1)
      if (this.el.value[caret - 1] === '/' && !/[^\s]*[:/\\][^\s]*$/.test(before)) {
        this.session = { prefix: before, suffix: this.el.value.slice(caret) }
      }
    }
    // A deleted slash ends its session without immediately reopening automatic suggestions.
    if (this.session && !this.currentToken()) {
      this.close()
      return
    }
    this.automatic = !this.session
    if (!this.currentToken()) {
      this.close()
      return
    }
    this.timer = setTimeout(() => {
      this.lookup().catch(this.close)
    }, DEBOUNCE)
  }

  private async lookup() {
    const token = this.currentToken()
    const request = ++this.request
    if (!token) {
      this.close()
      return
    }
    const prefixed = PREFIXED.exec(token.text.trim())
    const prefix = prefixed?.[1] ?? ''
    const query = (prefixed ? prefixed[2] : token.text).trim()
    const syntax = prefixed ? [] : syntaxItems(query)
    const limit = tagCompletionLimit(settingsState.settings?.tagCompletionLimit)
    let hits: SearchHit[] = []
    if (ZH.test(query) || query.trim().length >= 2) {
      try {
        hits = await window.api.tagComplete(query, limit, PREFIX_CATEGORY[prefix.toLowerCase()])
      } catch {
        if (request === this.request && this.session) {
          this.token = token
          this.items = []
          this.message = '搜索暂不可用，请继续输入重试'
          this.render()
        }
        return
      }
    }
    // 结果回来时光标已经移走或又输入了新内容，丢弃
    if (request !== this.request || document.activeElement !== this.el) {
      return
    }
    const items = [...syntax, ...hits.map((hit) => tagItem(hit, prefix))].slice(0, limit)
    if (
      !this.session &&
      (!items.length ||
        (items.length === 1 && items[0].name.toLowerCase() === token.text.trim().toLowerCase()))
    ) {
      this.close()
      return
    }
    const current = this.currentToken()
    if (!current || current.text !== token.text) {
      return
    }
    this.message = '没有匹配的 Tag'
    if (!query) {
      this.message = '输入 Tag 名称或中文，空格可继续搜索'
    } else if (!ZH.test(query) && query.length < 2) {
      this.message = '再输入一个字母开始搜索'
    }
    this.token = token
    this.items = items
    this.active = 0
    this.render()
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (
      (!this.session && !this.automatic) ||
      event.isComposing ||
      this.composing ||
      event.keyCode === 229
    ) {
      return
    }
    if (this.items.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      this.active = (this.active + step + this.items.length) % this.items.length
      this.highlight()
    } else if (
      this.items.length &&
      (event.key === 'Tab' || event.key === 'Enter') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      this.accept(this.active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
    }
  }

  private onBlur = () => {
    // 让点击候选的 mousedown 先处理
    setTimeout(() => {
      if (document.activeElement !== this.el) {
        this.close()
      }
    }, 0)
  }

  close = () => {
    this.session = null
    this.automatic = false
    this.hide()
  }

  private hide = () => {
    clearTimeout(this.timer)
    this.request++
    this.popup?.remove()
    this.popup = null
    this.token = null
    this.items = []
  }

  private accept(index: number) {
    const item = this.items[index]
    const token = this.token
    const current = this.currentToken()
    if (!item || !token || !current || current.text !== token.text) {
      return
    }
    this.close()
    this.el.focus()
    this.el.setSelectionRange(token.start, token.end)
    // 一次原生输入，保留撤销并通知 v-model
    this.inserting = true
    try {
      document.execCommand('insertText', false, item.insert)
    } finally {
      this.inserting = false
    }
  }

  private render() {
    if (!this.popup) {
      this.popup = document.createElement('div')
      this.popup.className = 'tag-complete'
      this.popup.setAttribute('role', 'group')
      this.popup.setAttribute('aria-label', this.session ? 'Tag 快捷搜索' : 'Tag 自动补全')
      this.popup.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const option = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        if (option) {
          this.accept(Number(option.dataset.index))
        }
      })
      ;(this.el.closest('dialog') ?? document.body).append(this.popup)
    }
    const list = document.createElement('div')
    list.className = 'tag-complete-list'
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', 'Tag 候选')
    this.popup.replaceChildren(list)
    list.replaceChildren(
      ...this.items.map((item, index) => {
        const option = document.createElement('div')
        option.className = `tag-complete-item ${item.cls}`
        option.setAttribute('role', 'option')
        option.dataset.index = String(index)
        const dot = document.createElement('i')
        const name = document.createElement('b')
        name.textContent = item.name
        const zh = document.createElement('span')
        zh.className = 'tag-complete-zh'
        zh.textContent = item.note
        const count = document.createElement('small')
        count.textContent = item.count
        option.append(dot, name, zh, count)
        return option
      }),
    )
    if (!this.items.length) {
      const hint = document.createElement('div')
      hint.className = 'tag-complete-hint'
      hint.setAttribute('role', 'status')
      hint.textContent = this.message
      this.popup.append(hint)
    }
    this.highlight()
    this.place()
  }

  private highlight() {
    this.popup?.querySelectorAll<HTMLElement>('[data-index]').forEach((option, index) => {
      option.classList.toggle('active', index === this.active)
      option.setAttribute('aria-selected', String(index === this.active))
      if (index === this.active) {
        const list = option.parentElement!
        const top = option.offsetTop
        if (top < list.scrollTop) {
          list.scrollTop = top
        } else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = top + option.offsetHeight - list.clientHeight
        }
      }
    })
  }

  private place() {
    if (!this.popup || !this.token) {
      return
    }
    const caret = caretRect(this.el, this.token.start)
    const width = 300
    const height = this.popup.offsetHeight
    const below = caret.bottom + 6 + height <= innerHeight - 8
    this.popup.style.left = `${Math.max(8, Math.min(caret.left - 10, innerWidth - width - 8))}px`
    this.popup.style.top = `${below ? caret.bottom + 6 : Math.max(8, caret.top - height - 6)}px`
  }
}

const instances = new WeakMap<HTMLTextAreaElement, Completion>()
export const vTagComplete = {
  mounted(el: HTMLTextAreaElement) {
    instances.set(el, new Completion(el))
  },
  unmounted(el: HTMLTextAreaElement) {
    instances.get(el)?.dispose()
    instances.delete(el)
  },
}
