/**
 * 列表增删动效，配合 <TransitionGroup name="list" @before-leave="detachLeaving">（样式见 motion.css）。
 * 离场元素先移出文档流并固定在原位淡出，其余项立即按新布局通过 move 过渡平滑补位。
 * 列表容器需要 position: relative。
 */
export function detachLeaving(el: Element): void {
  const node = el as HTMLElement
  const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = node
  Object.assign(node.style, {
    position: 'absolute',
    left: `${offsetLeft}px`,
    top: `${offsetTop}px`,
    width: `${offsetWidth}px`,
    height: `${offsetHeight}px`,
    margin: '0',
  })
}

const ids = new WeakMap<object, number>()
let seq = 0

/** 没有 id 的对象（如角色草稿）按对象身份生成稳定 key，删除中间项时动画落在正确的元素上 */
export function identityKey(item: object): number {
  let id = ids.get(item)
  if (id === undefined) {
    id = ++seq
    ids.set(item, id)
  }
  return id
}
