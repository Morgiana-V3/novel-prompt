import { createHash } from 'node:crypto'
import type { NaiVersion } from '../../shared/generation/types'

const ROOT = 'https://assets.quicktagcloud.com/data/'
const MAX_BYTES = 24 * 1024 * 1024

async function readBytes(path: string): Promise<Buffer> {
  const response = await fetch(ROOT + path, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
  if (!response.ok || !response.body) {
    throw new Error(`图鉴加载失败（HTTP ${response.status}）`)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.length
      if (size > MAX_BYTES) {
        throw new Error('图鉴数据超过大小限制')
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

export async function fetchArtistCodex(version: NaiVersion): Promise<unknown> {
  // These are public catalog files; no NovelAI token or user prompt is sent.
  const pointer = JSON.parse((await readBytes('v2/current.json')).toString('utf8'))
  if (!/^r2-[a-f0-9]{64}$/.test(pointer?.release)) {
    throw new Error('图鉴发布版本格式不受支持')
  }
  const manifest = JSON.parse(
    (await readBytes(`v2/releases/${pointer.release}/manifest.json`)).toString('utf8'),
  )
  const file = `artist_nai${version === 'v5' ? '5' : '45'}_personal.json`
  const hash = manifest?.files?.[file]?.sha256
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('图鉴文件索引无效')
  }
  const bytes = await readBytes(`objects/sha256/${hash.slice(0, 2)}/${hash}.json`)
  if (createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new Error('图鉴数据校验失败，请重试')
  }
  return JSON.parse(bytes.toString('utf8'))
}
