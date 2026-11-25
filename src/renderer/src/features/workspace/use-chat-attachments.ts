import { nextTick, onScopeDispose, ref, type Ref } from 'vue'
import type { ChatAttachment } from '@shared/workspace/attachments'
import { MAX_REFERENCES } from '@shared/generation/references'
import { cleanErr } from '../../shared/lib/format'

export function useChatAttachments(
  images: Ref<ChatAttachment[]>,
  importing: Ref<boolean>,
  blocked: () => boolean,
  workspaceId: () => string,
) {
  const fileInput = ref<HTMLInputElement>()
  const feedback = ref('')
  const dragging = ref(false)
  let alive = true
  let depth = 0
  onScopeDispose(() => {
    alive = false
    importing.value = false
  })
  async function add(sources: Array<File | string>) {
    if (!sources.length || blocked() || importing.value) {
      return
    }
    const id = workspaceId()
    importing.value = true
    feedback.value = ''
    const errors = new Set<string>()
    try {
      for (const source of sources) {
        if (images.value.length >= MAX_REFERENCES) {
          errors.add(`本应用每条消息最多附加 ${MAX_REFERENCES} 张图片`)
          break
        }
        try {
          if (typeof source !== 'string' && source.size > 40 * 1024 * 1024) {
            throw new Error('单张图片不能超过 40 MB')
          }
          const name = typeof source === 'string' ? source : source.name
          const imageName = await window.api.naiImportReference(
            typeof source === 'string' ? source : new Uint8Array(await source.arrayBuffer()),
          )
          if (!alive || workspaceId() !== id) {
            return
          }
          if (images.value.some((image) => image.imageName === imageName)) {
            errors.add('相同图片已在输入框中')
            continue
          }
          images.value = [
            ...images.value,
            { imageName, label: (name || '粘贴的图片').slice(0, 120), purpose: 'discussion' },
          ]
          await nextTick()
        } catch (error) {
          errors.add(cleanErr(error))
        }
      }
      if (alive) {
        feedback.value = [...errors].join(' · ')
      }
    } finally {
      if (alive) {
        importing.value = false
      }
    }
  }
  async function pick(event: Event) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    await add(files)
  }
  async function paste(event: ClipboardEvent) {
    const data = event.clipboardData
    if (!data) {
      return
    }
    const files = Array.from(data.files)
    if (!files.length) {
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }
      }
    }
    if (files.length) {
      event.preventDefault()
      await add(files)
    }
  }
  function isImageDrag(event: DragEvent) {
    return (
      event.dataTransfer?.types.some((type) => ['Files', 'text/uri-list'].includes(type)) ?? false
    )
  }
  function enter(event: DragEvent) {
    if (isImageDrag(event)) {
      event.preventDefault()
      depth++
      dragging.value = !blocked()
    }
  }
  function over(event: DragEvent) {
    if (isImageDrag(event)) {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy'
      }
    }
  }
  function leave() {
    depth = Math.max(0, depth - 1)
    if (!depth) {
      dragging.value = false
    }
  }
  async function drop(event: DragEvent) {
    depth = 0
    dragging.value = false
    const data = event.dataTransfer
    if (!data || !isImageDrag(event)) {
      return
    }
    event.preventDefault()
    const files = Array.from(data.files)
    if (files.length) {
      await add(files)
      return
    }
    const url = data.getData('text/uri-list').trim()
    if (url.startsWith('np-img://img/')) {
      try {
        await add([decodeURIComponent(new URL(url).pathname.slice(1))])
      } catch {
        feedback.value = '无法读取拖入的图片'
      }
    } else {
      feedback.value = '请拖入本地图片文件，或复制图片后粘贴'
    }
  }
  return { fileInput, feedback, dragging, pick, paste, enter, over, leave, drop }
}
