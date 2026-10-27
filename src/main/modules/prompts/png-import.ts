import { promisify } from 'node:util'
import { inflate } from 'node:zlib'
import { parsePngPrompt } from '../../../shared/prompts/import'

const inflateText = promisify(inflate)
export function readPngPrompt(bytes: Uint8Array) {
  return parsePngPrompt(bytes, inflateText)
}
