import MarkdownIt from 'markdown-it'
import { isWebUrl } from '../../../../shared/web-url'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false })
markdown.validateLink = isWebUrl
// AI responses should not silently load remote images or tracking URLs.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content)
export function renderMarkdown(text: string): string {
  return markdown.render(text)
}

export interface MarkdownOptions {
  localLinks?: boolean
  resolveImage?: (path: string) => string | null
}

export function renderDocumentMarkdown(text: string, options: MarkdownOptions): string {
  const document = new MarkdownIt({
    html: false,
    breaks: false,
    linkify: false,
    typographer: false,
  })
  document.validateLink = (url) =>
    isWebUrl(url) ||
    (!!options.localLinks && !/^[a-z][a-z0-9+.-]*:|^[/\\]|[\\\x00-\x1f]/i.test(url))
  document.renderer.rules.image = (tokens, index) => {
    const token = tokens[index]
    const url = options.resolveImage?.(String(token.attrGet('src') ?? ''))
    const alt = document.utils.escapeHtml(token.content)
    return url
      ? `<img src="${document.utils.escapeHtml(url)}" alt="${alt}" />`
      : `<span>${alt || '图片未包含在 Skill 中'}</span>`
  }
  const headings = new Map<string, number>()
  document.renderer.rules.heading_open = (tokens, index, renderOptions, environment, renderer) => {
    const base =
      (tokens[index + 1]?.content ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_ -]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section'
    const count = headings.get(base) ?? 0
    headings.set(base, count + 1)
    tokens[index].attrSet('id', count ? `${base}-${count}` : base)
    return renderer.renderToken(tokens, index, renderOptions)
  }
  return document.render(text)
}
