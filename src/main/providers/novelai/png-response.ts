import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

/**
 * 读取 ZIP（NovelAI 生图接口返回的格式）。通过中央目录定位条目，
 * 只支持「存储」与「deflate」两种压缩方式，足够解出 PNG。
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // 中央目录结束标记 0x06054b50，位于末尾（可能带最长 64KB 的注释）
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    throw new Error('返回内容不是有效的 ZIP')
  }
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏')
    }
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const local = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8')
    off += 46 + nameLen + extraLen + commentLen

    if (buf.readUInt32LE(local) !== 0x04034b50) {
      throw new Error('ZIP 条目损坏')
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + compSize)
    if (method === 0) {
      out.push({ name, data: Buffer.from(raw) })
    } else if (method === 8) {
      out.push({ name, data: inflateRawSync(raw) })
    }
  }
  return out
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export const isPng = (bytes: Buffer) => bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIG)

/** 从 IHDR 读取 PNG 尺寸 */
export function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (!isPng(bytes)) {
    return undefined
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
