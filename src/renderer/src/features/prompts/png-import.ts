import { parsePngPrompt } from '@shared/prompts/import'

export async function readPngPrompt(file: Blob) {
  const inflate = async (bytes: Uint8Array) => {
    const stream = new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return parsePngPrompt(new Uint8Array(await file.arrayBuffer()), inflate)
}
