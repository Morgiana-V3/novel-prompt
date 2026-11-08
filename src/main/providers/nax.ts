import { crc32, inflateRawSync } from 'node:zlib'

const MAX_BYTES = 24 * 1024 * 1024
let cached: { expires: number; data: Promise<unknown> } | undefined

/** Read only the public export's tags.json, in memory, with bounded decompression. */
export function readNaxArchive(bytes: Buffer): unknown {
  const invalid = () => new Error('NAX 图鉴压缩包无效，请重试')
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset
      break
    }
  }
  if (end < 0 || bytes.readUInt32LE(end + 4) !== 0) {
    throw invalid()
  }
  const count = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  const directory = bytes.readUInt32LE(end + 16)
  if (count > 100 || count !== bytes.readUInt16LE(end + 8) || directory + directorySize !== end) {
    throw invalid()
  }
  let offset = directory
  let result: Buffer | undefined
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw invalid()
    }
    const nameLength = bytes.readUInt16LE(offset + 28)
    const next =
      offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
    if (next > end) {
      throw invalid()
    }
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === 'tags.json') {
      const method = bytes.readUInt16LE(offset + 10)
      const compressedSize = bytes.readUInt32LE(offset + 20)
      const size = bytes.readUInt32LE(offset + 24)
      const local = bytes.readUInt32LE(offset + 42)
      if (
        result ||
        size > MAX_BYTES ||
        compressedSize > MAX_BYTES ||
        (bytes.readUInt16LE(offset + 8) & 1) !== 0 ||
        bytes.readUInt16LE(offset + 34) !== 0 ||
        local + 30 > directory ||
        bytes.readUInt32LE(local) !== 0x04034b50 ||
        bytes.readUInt16LE(local + 8) !== method ||
        (bytes.readUInt16LE(local + 6) & 1) !== 0
      ) {
        throw invalid()
      }
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
      if (
        start + compressedSize > directory ||
        bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)).toString('utf8') !==
          name
      ) {
        throw invalid()
      }
      const compressed = bytes.subarray(start, start + compressedSize)
      if (method === 0) {
        result = compressed
      } else if (method === 8) {
        result = inflateRawSync(compressed, { maxOutputLength: MAX_BYTES })
      } else {
        throw invalid()
      }
      if (result.length !== size || crc32(result) !== bytes.readUInt32LE(offset + 16)) {
        throw invalid()
      }
    }
    offset = next
  }
  if (!result || offset !== end) {
    throw invalid()
  }
  return JSON.parse(result.toString('utf8'))
}

async function downloadCatalog(): Promise<unknown> {
  // Public export only: no account credentials, prompts or reference images are sent.
  const response = await fetch('https://nax.moe/downloads/tags.zip', {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
  if (!response.ok || !response.body) {
    throw new Error(`NAX 图鉴加载失败（HTTP ${response.status}）`)
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
        throw new Error('NAX 图鉴数据超过大小限制')
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return readNaxArchive(Buffer.concat(chunks))
}

export function fetchNaxCatalog(): Promise<unknown> {
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }
  const data = downloadCatalog()
  cached = { data, expires: Date.now() + 3600000 }
  void data.catch(() => {
    if (cached?.data === data) {
      cached = undefined
    }
  })
  return data
}
