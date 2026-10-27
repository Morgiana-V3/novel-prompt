import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'

/** Windows 上杀毒软件 / 索引服务短暂占用目标文件时 rename 会失败，稍等重试即可 */
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRIES = 5
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? ''
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const tmpOf = (file: string) => `${file}.${process.pid}-${Date.now()}.tmp`

/** 先写临时文件再改名：中途崩溃或断电只会留下 .tmp，原文件保持完整 */
export function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  encoding: BufferEncoding = 'utf8',
): void {
  const temporaryPath = tmpOf(file)
  writeFileSync(temporaryPath, data, typeof data === 'string' ? encoding : undefined)
  for (let i = 0; ; i++) {
    try {
      renameSync(temporaryPath, file)
      return
    } catch (error) {
      if (i >= RETRIES || !RETRYABLE.has(code(error))) {
        try {
          unlinkSync(temporaryPath)
        } catch {
          /* 临时文件清理失败不影响结果 */
        }
        throw error
      }
      sleepSync(40 * (i + 1))
    }
  }
}

export async function writeFileAtomicAsync(file: string, data: string | Uint8Array): Promise<void> {
  const temporaryPath = tmpOf(file)
  await writeFile(temporaryPath, data)
  for (let i = 0; ; i++) {
    try {
      await rename(temporaryPath, file)
      return
    } catch (error) {
      if (i >= RETRIES || !RETRYABLE.has(code(error))) {
        await unlink(temporaryPath).catch(() => {})
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (i + 1)))
    }
  }
}

/**
 * 解析失败的用户文件改名留存（xxx.corrupt-时间戳），
 * 避免之后的写入用空数据覆盖掉还可能手动恢复的内容。
 */
export function quarantine(file: string): string | null {
  if (!existsSync(file)) {
    return null
  }
  const dest = `${file}.corrupt-${Date.now()}`
  try {
    renameSync(file, dest)
    console.warn('[data] 文件无法解析，已另存为', dest)
    return dest
  } catch {
    return null
  }
}
