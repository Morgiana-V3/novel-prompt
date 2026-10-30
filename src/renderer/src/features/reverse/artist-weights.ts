import { parsePrompt } from '@shared/prompts/parser'
import type { PromptToken } from '@shared/prompts/types'

export function styleArtists(prompt: string) {
  return parsePrompt(prompt)
    .map((token, index) => ({ ...token, index }))
    .filter((token) => token.prefix === 'artist:')
}

function serialize(tokens: PromptToken[]) {
  let section = 0
  return tokens
    .map((token, index) => {
      let separator = index ? ', ' : ''
      if (token.section > section) {
        separator = ' | '.repeat(token.section - section)
        section = token.section
      }
      const text = token.weight === 1 ? token.raw : `${token.weight}::${token.raw}::`
      return separator + text
    })
    .join('')
}

/** Flatten shared weight groups so adjusting one artist never changes its neighbours. */
export function setArtistWeight(prompt: string, index: number, weight: number) {
  const tokens = parsePrompt(prompt)
  if (!Number.isFinite(weight) || tokens[index]?.prefix !== 'artist:') {
    return prompt
  }
  tokens[index].weight = Math.round(weight * 1000) / 1000
  return serialize(tokens)
}

export function removeStyleArtist(prompt: string, index: number) {
  return serialize(parsePrompt(prompt).filter((_, tokenIndex) => tokenIndex !== index))
}
