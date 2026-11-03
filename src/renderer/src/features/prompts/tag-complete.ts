import type { SearchHit, TagCategory } from '@shared/tags/types'
import { CAT_CLASS } from '../tags/state'
import { fmtCount } from '../../shared/lib/format'

/**
 * 提示词输入时的 tag 补全（参考 NovelAI）：光标停在一个 tag 的末尾时，按这段文字查本地词库，
 * 在光标下方列出几条候选；↑↓ 选择，Tab / Enter 插入（一次可撤销），Esc 关闭。
 * 检索在主进程走索引，单次通常不到 1 毫秒；输入防抖 120ms，过期的结果直接丢弃。
 * NovelAI 的专用写法（artist:、Text:、source# 等）排在最前；写了 artist: 之后只补全画师。
 */

const DEBOUNCE = 120
const LIMIT = 8
const ZH = /[\u4e00-\u9fff]/

/** 候选项：insert 替换整个 token；语法项插入后不追加「, 」，方便接着写 */
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
function currentToken(el: HTMLTextAreaElement): Token | null {
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

  constructor(private el: HTMLTextAreaElement) {
    el.addEventListener('input', this.onInput)
    el.addEventListener('keydown', this.onKeydown, true)
    el.addEventListener('blur', this.onBlur)
    el.addEventListener('scroll', this.close)
  }

  dispose() {
    this.el.removeEventListener('input', this.onInput)
    this.el.removeEventListener('keydown', this.onKeydown, true)
    this.el.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('scroll', this.close)
    this.close()
  }

  private onInput = (event: Event) => {
    clearTimeout(this.timer)
    // 输入法拼写中不查（插入候选后光标停在「, 」之后，自然不会再弹出）
    if ((event as InputEvent).isComposing || this.el.readOnly) {
      return
    }
    this.timer = setTimeout(() => {
      this.lookup().catch(this.close)
    }, DEBOUNCE)
  }

  private async lookup() {
    const token = currentToken(this.el)
    const request = ++this.request
    if (!token) {
      this.close()
      return
    }
    const prefixed = PREFIXED.exec(token.text)
    const prefix = prefixed?.[1] ?? ''
    const query = prefixed ? prefixed[2] : token.text
    const syntax = prefixed ? [] : syntaxItems(query)
    let hits: SearchHit[] = []
    if (ZH.test(query) || query.trim().length >= 2) {
      try {
        hits = await window.api.tagComplete(query, LIMIT, PREFIX_CATEGORY[prefix.toLowerCase()])
      } catch {
        return
      }
    }
    // 结果回来时光标已经移走或又输入了新内容，丢弃
    if (request !== this.request || document.activeElement !== this.el) {
      return
    }
    const items = [...syntax, ...hits.map((hit) => tagItem(hit, prefix))].slice(0, LIMIT)
    const exact =
      items.length === 1 && items[0].name.toLowerCase() === token.text.trim().toLowerCase()
    if (!items.length || exact) {
      this.close()
      return
    }
    this.token = token
    this.items = items
    this.active = 0
    this.render()
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (!this.popup || event.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      this.active = (this.active + step + this.items.length) % this.items.length
      this.highlight()
    } else if (
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
    clearTimeout(this.timer)
    this.request++
    this.popup?.remove()
    this.popup = null
    this.token = null
  }

  private accept(index: number) {
    const item = this.items[index]
    const token = this.token
    if (!item || !token) {
      return
    }
    this.close()
    const after = this.el.value.slice(token.end)
    const suffix = item.syntax || /^\s*[,|\n]/.test(after) || /^[)\]}]/.test(after) ? '' : ', '
    this.el.focus()
    this.el.setSelectionRange(token.start, token.end)
    // 一次原生输入，保留撤销并通知 v-model
    document.execCommand('insertText', false, item.insert + suffix)
  }

  private render() {
    if (!this.popup) {
      this.popup = document.createElement('div')
      this.popup.className = 'tag-complete'
      this.popup.setAttribute('role', 'listbox')
      this.popup.setAttribute('aria-label', 'tag 补全')
      this.popup.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const option = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        if (option) {
          this.accept(Number(option.dataset.index))
        }
      })
      ;(this.el.closest('dialog') ?? document.body).append(this.popup)
    }
    this.popup.replaceChildren(
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
    this.highlight()
    this.place()
  }

  private highlight() {
    this.popup?.querySelectorAll<HTMLElement>('[data-index]').forEach((option, index) => {
      option.classList.toggle('active', index === this.active)
      option.setAttribute('aria-selected', String(index === this.active))
      if (index === this.active) {
        option.scrollIntoView({ block: 'nearest' })
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
