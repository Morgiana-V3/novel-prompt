export interface PromptSnippet {
  id: string
  name: string
  text: string
  category: string
  updatedAt: number
}
export type SnippetInput = Pick<PromptSnippet, 'name' | 'text' | 'category'> & { id?: string }
