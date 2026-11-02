import { parsePrompt } from './parser'

type Range = { start: number; end: number }
interface Scope extends Range {
  kind: 'brace' | 'bracket' | 'num'
  contentStart: number
}
interface Atom extends Range {
  kind: 'content' | 'open' | 'close' | 'gap' | 'section'
  scopes?: Scope[]
}
function lastScope(list: Scope[], kind: Scope['kind']): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].kind === kind) {
      return i
    }
  }
  return -1
}

/** Remove occurrences, then clean only the affected separators and newly empty weight scopes. */
export function removePromptTokens(input: string, targets: Range[]): string {
  const tokens = parsePrompt(input)
  const removed = new Set(
    tokens.filter((t) => targets.some((r) => r.start === t.start && r.end === t.end)),
  )
  if (!removed.size) {
    return input
  }
  const byStart = new Map(tokens.map((t) => [t.start, t]))
  const stack: Scope[] = []
  const terminated: Scope[] = []
  const scopes: Scope[] = []
  const atoms: Atom[] = []
  for (let i = 0; i < input.length;) {
    const token = byStart.get(i)
    if (token) {
      atoms.push({ ...token, kind: 'content' })
      i = token.end
      continue
    }
    const ch = input[i]
    const numeric = /^-?\d+(?:\.\d+)?::/.exec(input.slice(i))
    if (numeric || ch === '{' || ch === '[') {
      const end = i + (numeric?.[0].length ?? 1)
      let kind: Scope['kind'] = ch === '{' ? 'brace' : 'bracket'
      if (numeric) {
        kind = 'num'
      }
      const scope: Scope = { start: i, contentStart: end, end: input.length, kind }
      stack.push(scope)
      scopes.push(scope)
      atoms.push({ start: i, end, kind: 'open', scopes: [scope] })
      i = end
      continue
    }
    if (input.slice(i, i + 2) === '::' || ch === '}' || ch === ']') {
      const numericEnd = input.slice(i, i + 2) === '::'
      const end = i + (numericEnd ? 2 : 1)
      let closing: Scope[] = []
      if (numericEnd) {
        closing = stack.splice(0)
        terminated.push(...closing.filter((scope) => scope.kind !== 'num'))
      } else {
        const kind = ch === '}' ? 'brace' : 'bracket'
        const index = lastScope(stack, kind)
        if (index >= 0) {
          closing = stack.splice(index, 1)
        } else {
          const endedIndex = lastScope(terminated, kind)
          if (endedIndex >= 0) {
            atoms.push({ start: i, end, kind: 'close', scopes: terminated.splice(endedIndex, 1) })
            i = end
            continue
          }
        }
      }
      for (const scope of closing) {
        scope.end = i
      }
      atoms.push({ start: i, end, kind: 'close', scopes: closing })
      i = end
      continue
    }
    atoms.push({ start: i, end: i + 1, kind: ch === '|' ? 'section' : 'gap' })
    i++
  }
  // Do not clean pre-existing empty syntax unrelated to this removal.
  const empty = new Set(
    scopes.filter((scope) => {
      const contained = tokens.filter((t) => t.start >= scope.contentStart && t.end <= scope.end)
      return contained.length > 0 && contained.every((t) => removed.has(t))
    }),
  )
  const removedStarts = new Set([...removed].map((t) => t.start))
  let output = ''
  let gap = ''
  let dirty = false
  let lostBoundary = false
  let previous: Atom['kind'] | undefined
  function flush(next?: Atom['kind']) {
    if (dirty) {
      if (
        !previous ||
        previous === 'open' ||
        previous === 'section' ||
        !next ||
        next === 'close' ||
        next === 'section'
      ) {
        gap = gap.replace(/,/g, '')
        if (!previous || !next || previous === 'open' || next === 'close') {
          gap = ''
        }
      } else if (gap.includes(',')) {
        gap = gap.includes('\n') ? ',' + gap.replace(/,/g, '').replace(/[ \t]+\r?\n/g, '\n') : ', '
      } else if (
        lostBoundary &&
        previous === 'content' &&
        next === 'content' &&
        !/[\r\n]/.test(gap)
      ) {
        // Removing a whole weight group must not merge its two neighbouring tags.
        gap = ', '
      }
    }
    output += gap
    gap = ''
    dirty = false
    lostBoundary = false
  }
  for (const atom of atoms) {
    const discard =
      atom.kind === 'content'
        ? removedStarts.has(atom.start)
        : !!atom.scopes?.length && atom.scopes.every((s) => empty.has(s))
    if (discard) {
      dirty = true
      lostBoundary ||= atom.kind === 'open' || atom.kind === 'close'
      continue
    }
    const text = input.slice(atom.start, atom.end)
    if (atom.kind === 'gap' && /^[\s,]+$/.test(text)) {
      gap += text
      continue
    }
    flush(atom.kind)
    output += text
    previous = atom.kind
  }
  flush()
  return output
}
