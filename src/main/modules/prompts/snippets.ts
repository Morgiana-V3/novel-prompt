import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dataFile } from '../../infrastructure/paths'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import type { PromptSnippet, SnippetInput } from '../../../shared/prompts/snippets'

export function listSnippets(): PromptSnippet[] {
  const path = dataFile('prompt-snippets.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
}
export function saveSnippet(input: SnippetInput): PromptSnippet {
  if (
    !input ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 120 ||
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.text.length > 100000 ||
    typeof input.category !== 'string' ||
    input.category.length > 80
  ) {
    throw new Error('请填写片段名称和正文，并检查长度')
  }
  const items = listSnippets()
  if (input.id && !items.some((item) => item.id === input.id)) {
    throw new Error('片段不存在，请刷新后重试')
  }
  const snippet = {
    id: input.id || randomUUID(),
    name: input.name.trim(),
    text: input.text,
    category: input.category.trim(),
    updatedAt: Date.now(),
  }
  writeFileAtomic(
    dataFile('prompt-snippets.json'),
    JSON.stringify([snippet, ...items.filter((item) => item.id !== snippet.id)]),
  )
  return snippet
}
export function deleteSnippet(id: string): void {
  writeFileAtomic(
    dataFile('prompt-snippets.json'),
    JSON.stringify(listSnippets().filter((item) => item.id !== id)),
  )
}
