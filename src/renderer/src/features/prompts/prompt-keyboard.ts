import { parsePrompt } from '@shared/prompts/parser'
import { promptSelectionRanges, removePromptTokens } from '@shared/prompts/remove-tokens'

/** Whole-token selections (including click-to-locate) delete their empty syntax; ordinary typing stays native. */
export function deleteSelectedToken(event: KeyboardEvent) {
  const input = event.target
  if (
    !(input instanceof HTMLTextAreaElement) ||
    input.readOnly ||
    input.disabled ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !['Backspace', 'Delete'].includes(event.key)
  ) {
    return
  }
  const start = input.selectionStart
  const end = input.selectionEnd
  if (start === end) {
    return
  }
  const contained = parsePrompt(input.value).filter((t) => t.start >= start && t.end <= end)
  if (contained.length !== 1) {
    return
  }
  const token = contained[0]
  if (token.start !== start || token.end !== end) {
    const ranges = promptSelectionRanges(input.value, [token])
    if (ranges.length !== 1 || ranges[0].start !== start || ranges[0].end !== end) {
      return
    }
  }
  const next = removePromptTokens(input.value, [token])
  event.preventDefault()
  input.select()
  const applied = next
    ? document.execCommand('insertText', false, next)
    : document.execCommand('delete')
  if (!applied || input.value !== next) {
    input.value = next
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  input.setSelectionRange(Math.min(start, next.length), Math.min(start, next.length))
}
