import type { SkillResource } from '@shared/skills/types'

export function resolveSkillLink(
  from: string,
  href: string,
): { path: string; anchor: string } | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(href)
  } catch {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:|^[/\\]|[\\\x00-\x1f]/i.test(decoded)) {
    return null
  }
  const hash = decoded.indexOf('#')
  const path = hash < 0 ? decoded : decoded.slice(0, hash)
  const anchor = hash < 0 ? '' : decoded.slice(hash + 1)
  if (!path) {
    return { path: from, anchor }
  }
  const parts = from.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) {
        return null
      }
      parts.pop()
    } else if (part && part !== '.') {
      parts.push(part)
    }
  }
  return { path: parts.join('/'), anchor }
}

export function skillImageUrl(resource?: SkillResource): string | null {
  if (resource?.kind !== 'image') {
    return null
  }
  const extension = resource.path.split('.').pop()?.toLowerCase()
  if (!extension || !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) {
    return null
  }
  return `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${resource.content}`
}
