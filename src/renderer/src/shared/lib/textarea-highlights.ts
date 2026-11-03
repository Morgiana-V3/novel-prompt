const metrics = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'tabSize',
  'wordBreak',
  'overflowWrap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

/** Match the textarea's text layout without replacing its native editing surface. */
export function createTextareaMirror(input: HTMLTextAreaElement) {
  const mirror = document.createElement('div')
  const style = getComputedStyle(input)
  for (const property of metrics) {
    mirror.style[property] = style[property]
  }
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    boxSizing: 'border-box',
    width: `${input.clientWidth}px`,
    whiteSpace: input.wrap === 'off' ? 'pre' : 'pre-wrap',
  })
  return mirror
}

/** Native textareas only support one selection; paint additional ranges underneath. */
export function highlightTextareaRanges(
  input: HTMLTextAreaElement,
  ranges: { start: number; end: number }[],
  clear: () => void,
) {
  const parent = input.parentElement!
  const oldParentPosition = parent.style.position
  const oldPosition = input.style.position
  const oldZIndex = input.style.zIndex
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative'
  }
  input.style.position = 'relative'
  input.style.zIndex = '1'
  const layer = document.createElement('div')
  layer.className = 'textarea-token-highlights'
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'absolute',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '0',
  })
  const mirror = createTextareaMirror(input)
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'visible',
    color: 'transparent',
  })
  let cursor = 0
  for (const { start, end } of [...ranges].sort((a, b) => a.start - b.start)) {
    if (start < cursor || end <= start || end > input.value.length) {
      continue
    }
    const mark = document.createElement('mark')
    mark.textContent = input.value.slice(start, end)
    mark.style.cssText = 'color:transparent;background:#ffc4d8;border-radius:2px;'
    mirror.append(input.value.slice(cursor, start), mark)
    cursor = end
  }
  mirror.append(input.value.slice(cursor))
  layer.append(mirror)
  parent.append(layer)
  function sync() {
    const box = input.getBoundingClientRect()
    const host = parent.getBoundingClientRect()
    Object.assign(layer.style, {
      left: `${box.left - host.left - parent.clientLeft + parent.scrollLeft + input.clientLeft}px`,
      top: `${box.top - host.top - parent.clientTop + parent.scrollTop + input.clientTop}px`,
      width: `${input.clientWidth}px`,
      height: `${input.clientHeight}px`,
    })
    const style = getComputedStyle(input)
    for (const property of metrics) {
      mirror.style[property] = style[property]
    }
    Object.assign(mirror.style, {
      width: `${input.clientWidth}px`,
      left: `${-input.scrollLeft}px`,
      top: `${-input.scrollTop}px`,
    })
  }
  const observer = new ResizeObserver(sync)
  observer.observe(input)
  input.addEventListener('scroll', sync)
  input.addEventListener('focus', clear)
  sync()
  return () => {
    observer.disconnect()
    input.removeEventListener('scroll', sync)
    input.removeEventListener('focus', clear)
    layer.remove()
    input.style.position = oldPosition
    input.style.zIndex = oldZIndex
    parent.style.position = oldParentPosition
  }
}
