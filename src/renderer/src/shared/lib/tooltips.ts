/** One delegated tooltip for existing title hints, including disabled buttons and teleported dialogs. */
export function installTooltips(): () => void {
  const tip = document.createElement('div')
  tip.id = 'app-tooltip'
  tip.className = 'app-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.setAttribute('popover', 'manual')
  let target: HTMLElement | null = null
  let timer = 0
  let frame = 0
  let temporaryLabel = false
  const titles = new Map<HTMLElement, string>()
  function hide() {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    if (tip.matches(':popover-open')) {
      tip.hidePopover()
    }
    tip.remove()
    if (target) {
      const ids = (target.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((id) => id && id !== tip.id)
      if (ids.length) {
        target.setAttribute('aria-describedby', ids.join(' '))
      } else {
        target.removeAttribute('aria-describedby')
      }
    }
  }
  const observer = new MutationObserver(() => {
    for (const element of titles.keys()) {
      const value = element.getAttribute('title')
      if (value !== null) {
        titles.set(element, value)
        element.removeAttribute('title')
      }
    }
    if (target && tip.isConnected) {
      tip.textContent = titles.get(target) ?? ''
    }
  })
  function reset() {
    hide()
    observer.disconnect()
    for (const [element, title] of titles) {
      if (!element.hasAttribute('title')) {
        element.setAttribute('title', title)
      }
    }
    if (temporaryLabel) {
      target?.removeAttribute('aria-label')
    }
    titles.clear()
    target = null
    temporaryLabel = false
  }
  function place() {
    if (!target?.isConnected || !target.getClientRects().length) {
      reset()
      return
    }
    const anchor = target.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    if (anchor.bottom < 0 || anchor.top > innerHeight) {
      reset()
      return
    }
    const left = Math.max(
      12,
      Math.min(anchor.left + (anchor.width - box.width) / 2, innerWidth - box.width - 12),
    )
    const below = anchor.bottom + 7
    const fitsBelow = below + box.height <= innerHeight - 12
    const top = fitsBelow ? below : Math.max(12, anchor.top - box.height - 7)
    const roundedLeft = Math.round(left)
    tip.dataset.side = fitsBelow ? 'bottom' : 'top'
    tip.style.setProperty(
      '--tooltip-arrow-x',
      `${Math.max(9, Math.min(anchor.left + anchor.width / 2 - roundedLeft, box.width - 9))}px`,
    )
    tip.style.left = `${roundedLeft}px`
    tip.style.top = `${Math.round(top)}px`
    frame = requestAnimationFrame(place)
  }
  function find(node: EventTarget | null): HTMLElement | null {
    for (
      let element = node instanceof Element ? node : null;
      element;
      element = element.parentElement
    ) {
      if (
        element instanceof HTMLElement &&
        (titles.get(element) ?? element.getAttribute('title'))?.trim()
      ) {
        return element
      }
    }
    return null
  }
  function begin(element: HTMLElement | null, delay: number) {
    if (element === target) {
      return
    }
    reset()
    if (!element) {
      return
    }
    target = element
    // Suppress ancestor titles too; otherwise the browser displays a second, native tooltip.
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const text = node.getAttribute('title')
      if (text !== null) {
        titles.set(node, text)
        node.removeAttribute('title')
        observer.observe(node, { attributes: true, attributeFilter: ['title'] })
      }
    }
    if (
      !element.hasAttribute('aria-label') &&
      !element.textContent?.trim() &&
      element.matches('button, a, input')
    ) {
      element.setAttribute('aria-label', titles.get(element) ?? '')
      temporaryLabel = true
    }
    timer = window.setTimeout(() => {
      if (!target?.isConnected || !target.getClientRects().length || target.closest('[inert]')) {
        reset()
        return
      }
      tip.textContent = titles.get(target) ?? ''
      ;(target.closest('dialog') ?? document.body).appendChild(tip)
      tip.showPopover()
      const described = target.getAttribute('aria-describedby')
      target.setAttribute('aria-describedby', [described, tip.id].filter(Boolean).join(' '))
      place()
    }, delay)
  }
  const over = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerType !== 'touch') {
      begin(find(pointerEvent.target), 450)
    }
  }
  const out = (pointerEvent: PointerEvent) => {
    if (
      target &&
      !(pointerEvent.relatedTarget instanceof Node && target.contains(pointerEvent.relatedTarget))
    ) {
      reset()
    }
  }
  const focus = (event2: FocusEvent) => {
    if ((event2.target as HTMLElement)?.matches(':focus-visible')) {
      begin(find(event2.target), 200)
    }
  }
  const blur = (event2: FocusEvent) => {
    if (target?.contains(event2.target as Node)) {
      reset()
    }
  }
  const key = () => hide()
  document.addEventListener('pointerover', over, true)
  document.addEventListener('pointerout', out, true)
  document.addEventListener('focusin', focus, true)
  document.addEventListener('focusout', blur, true)
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('keydown', key, true)
  document.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', reset)
  return () => {
    reset()
    document.removeEventListener('pointerover', over, true)
    document.removeEventListener('pointerout', out, true)
    document.removeEventListener('focusin', focus, true)
    document.removeEventListener('focusout', blur, true)
    document.removeEventListener('pointerdown', hide, true)
    document.removeEventListener('keydown', key, true)
    document.removeEventListener('scroll', hide, true)
    window.removeEventListener('resize', hide)
    window.removeEventListener('blur', reset)
  }
}
