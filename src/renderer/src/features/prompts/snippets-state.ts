import { reactive } from 'vue'
import type { PromptSnippet, SnippetInput } from '@shared/prompts/snippets'

/**
 * 提示词片段只有这一份：输入框里的快捷浮层和收藏页的片段库都读写这里，
 * 任何一处保存或删除，另一处立刻同步，不会出现「存了却看不到」。
 */
export const snippetStore = reactive({
  items: [] as PromptSnippet[],
  loaded: false,
})
let loading: Promise<PromptSnippet[]> | undefined
export function refreshSnippets(): Promise<PromptSnippet[]> {
  loading ??= window.api
    .snippetsList()
    .then((items) => {
      snippetStore.items = items
      snippetStore.loaded = true
      return items
    })
    .finally(() => {
      loading = undefined
    })
  return loading
}
export async function saveSnippet(input: SnippetInput): Promise<PromptSnippet> {
  const item = await window.api.snippetsSave({ ...input })
  snippetStore.items = [item, ...snippetStore.items.filter((entry) => entry.id !== item.id)]
  return item
}
export async function deleteSnippet(id: string): Promise<void> {
  await window.api.snippetsDelete(id)
  snippetStore.items = snippetStore.items.filter((item) => item.id !== id)
}
