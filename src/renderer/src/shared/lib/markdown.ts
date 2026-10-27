import MarkdownIt from 'markdown-it'
import { isWebUrl } from '../../../../shared/web-url'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false })
markdown.validateLink = isWebUrl
// AI responses should not silently load remote images or tracking URLs.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content)
export function renderMarkdown(text: string): string {
  return markdown.render(text)
}
