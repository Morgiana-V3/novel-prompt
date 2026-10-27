import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { McpLogEntry } from '../../../shared/contracts/mcp'
import { dataFile } from '../../infrastructure/paths'

/* ---------- 调用日志（设置页展示） ---------- */

export const LOG_FILE = 'mcp-log.jsonl'

export const LOG_KEEP = 300

export function appendLog(entry: McpLogEntry): void {
  try {
    const file = dataFile(LOG_FILE)
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    if (statSync(file).size > 200_000) {
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      writeFileSync(file, lines.slice(-LOG_KEEP).join('\n') + '\n', 'utf8')
    }
  } catch {
    /* 日志失败不影响调用 */
  }
}

export function readLog(limit = 30): McpLogEntry[] {
  const file = dataFile(LOG_FILE)
  if (!existsSync(file)) {
    return []
  }
  try {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .reverse()
      .map((text) => JSON.parse(text) as McpLogEntry)
  } catch {
    return []
  }
}
