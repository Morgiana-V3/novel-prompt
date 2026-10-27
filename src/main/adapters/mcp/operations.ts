import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dataFile } from '../../infrastructure/paths'
import type { McpResult, McpTool } from './types'

const RETENTION = 7 * 24 * 60 * 60 * 1000
const MAX_RECORDS = 10_000
const MAX_RESULT_BYTES = 64 * 1024
export const OPERATION_ID_SCHEMA = {
  type: 'string',
  minLength: 16,
  maxLength: 128,
  description:
    '可选的唯一操作编号（建议 UUID）。首次调用前生成；超时后用 get_operation 查询。同编号和相同参数只执行一次，记录保留 7 天。新意图使用新编号。',
}
type Status = 'running' | 'succeeded' | 'failed' | 'interrupted'
interface Operation {
  id: string
  tool: string
  fingerprint: string
  status: Status
  startedAt: number
  expiresAt: number
  finishedAt?: number
  result?: McpResult
  resultOmitted?: boolean
  persistenceWarning?: string
}
// Sort object keys so transport formatting cannot change an operation's identity.
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}
export const tracksOperation = (tool: McpTool) =>
  ['optimize_prompt', 'preview_prompt', 'plan_inpaint'].includes(tool.name) ||
  (!tool.annotations?.readOnlyHint &&
    !['report_workspace_progress', 'configure_tools'].includes(tool.name))

/** Shared by connections in one host. Persist intent BEFORE allowing side effects. */
export class OperationStore {
  private records = new Map<string, Operation>()
  private loadError = false
  constructor(private file: string) {
    if (!existsSync(file)) {
      return
    }
    try {
      const records: Operation[] = JSON.parse(readFileSync(file, 'utf8'))
      if (
        !Array.isArray(records) ||
        records.some(
          (operation) =>
            !operation ||
            typeof operation.id !== 'string' ||
            typeof operation.fingerprint !== 'string' ||
            !['running', 'succeeded', 'failed', 'interrupted'].includes(operation.status) ||
            !Number.isFinite(operation.expiresAt),
        )
      ) {
        throw Error('invalid operation journal')
      }
      for (const operation2 of records) {
        // A host exit does not prove rollback. Never automatically replay these operations.
        if (operation2.status === 'running') {
          operation2.status = 'interrupted'
          operation2.finishedAt = Date.now()
        }
        this.records.set(operation2.id, operation2)
      }
    } catch {
      this.loadError = true
    }
  }
  private persist() {
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify([...this.records.values()]), {
      mode: 0o600,
      flush: true,
    })
    renameSync(temporary, this.file)
  }
  find(id: string) {
    return this.records.get(id)
  }
  matches(record: Operation, tool: string, args: Record<string, unknown>) {
    return (
      record.tool === tool &&
      record.fingerprint === createHash('sha256').update(canonical(args)).digest('hex')
    )
  }
  begin(tool: string, args: Record<string, unknown>, id: string = randomUUID()): Operation {
    if (this.loadError) {
      throw Error(
        '操作记录无法读取，已阻止新的写入；请检查本地 mcp-operations.json 后恢复，勿盲目重试。',
      )
    }
    const now = Date.now()
    for (const [key, r] of this.records) {
      if (r.status !== 'running' && r.expiresAt < now) {
        this.records.delete(key)
      }
    }
    if (this.records.size >= MAX_RECORDS) {
      throw Error('操作记录已达 10000 条，已阻止新的写入；记录保留 7 天，请待过期后再操作。')
    }
    const record: Operation = {
      id,
      tool,
      fingerprint: createHash('sha256').update(canonical(args)).digest('hex'),
      status: 'running',
      startedAt: now,
      expiresAt: now + RETENTION,
    }
    this.records.set(id, record)
    try {
      this.persist()
    } catch (error) {
      this.records.delete(id)
      throw error
    }
    return record
  }
  finish(record: Operation, result: McpResult, interrupted = false) {
    if (interrupted) {
      record.status = 'interrupted'
    } else {
      if (result.isError) {
        record.status = 'failed'
      } else {
        record.status = 'succeeded'
      }
    }
    record.finishedAt = Date.now()
    if (Buffer.byteLength(JSON.stringify(result)) <= MAX_RESULT_BYTES) {
      record.result = result
    } else {
      record.resultOmitted = true
    }
    let bytes = 0
    for (const operation of [...this.records.values()].sort(
      (operation2, operation3) => operation3.startedAt - operation2.startedAt,
    )) {
      if (!operation.result) {
        continue
      }
      bytes += Buffer.byteLength(JSON.stringify(operation.result))
      if (bytes > 8 * 1024 * 1024) {
        delete operation.result
        operation.resultOmitted = true
      }
    }
    // If this write fails, disk still says running and restart will mark interrupted.
    // Keep the in-memory result; never turn a successful mutation into a retry suggestion.
    try {
      this.persist()
    } catch {
      record.persistenceWarning = '结果仅保留在本次运行内；本地记录写入失败，重启后需核对实际状态。'
    }
  }
  summary(record: Operation) {
    const { fingerprint: _, result: __, ...summary } = record
    const resolveNextAction = () => {
      if (record.status === 'running') {
        return '稍后用 get_operation 查询，勿重新提交。' as const
      }
      if (record.status === 'interrupted') {
        return '操作可能已部分完成；读取工作台、图库或任务状态核对结果，勿自动重放。' as const
      }
      if (record.status === 'failed') {
        return '核对错误及当前状态；同编号不会重试，修正后使用新编号。' as const
      }
      return '操作已完成；这是当时的结果，后续操作前重新读取当前状态。' as const
    }
    return {
      ...summary,
      nextAction: resolveNextAction(),
    }
  }
  query(id?: string) {
    if (this.loadError) {
      throw Error('操作记录无法读取，不能判断先前操作是否执行。')
    }
    if (id) {
      const operation = this.find(id)
      if (operation) {
        return {
          operation: this.summary(operation),
          ...(operation.result ? { result: operation.result } : {}),
        }
      }
      return {
        operation: null,
        nextAction:
          '未找到记录不代表从未执行（可能超过 7 天或连接到其他数据目录）；先核对环境和目标状态。',
      }
    }
    return {
      items: [...this.records.values()]
        .sort((operation, operation2) => operation2.startedAt - operation.startedAt)
        .slice(0, 20)
        .map((operation) => this.summary(operation)),
      retentionDays: 7,
    }
  }
}
const stores = new Map<string, OperationStore>()
export function operationStore() {
  const file = dataFile('mcp-operations.json')
  let store = stores.get(file)
  if (!store) {
    store = new OperationStore(file)
    stores.set(file, store)
  }
  return store
}
