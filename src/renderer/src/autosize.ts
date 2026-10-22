/** 文本框随内容自动增高，高度不够时由外层栏滚动，避免框内出现小滚动条 */
export function autoSize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export const vAutosize = {
  mounted(el: HTMLTextAreaElement) {
    el.addEventListener('input', () => autoSize(el))
    autoSize(el)
  },
  updated: autoSize
}

/** 重新计算容器内所有文本框的高度（视图从隐藏切回、窗口缩放、批量写入内容后调用） */
export function resizeWithin(root?: HTMLElement | null): void {
  root?.querySelectorAll('textarea').forEach((el) => autoSize(el as HTMLTextAreaElement))
}
