/** Validate the JSON Schema subset used by our tools before any side effect. */
export function validateArguments(value: unknown, schema: Record<string, any>, path = 'arguments'): void {
  if (schema.anyOf) {
    const failures: string[] = []
    const matches = schema.anyOf.some((branch: Record<string, any>) => { try { validateArguments(value, branch, path); return true } catch (e) { failures.push((e as Error).message); return false } })
    if (!matches) throw new Error(`${path} 不符合声明的结构：${failures.slice(0, 3).join('；')}`)
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const matches = (type: string) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
    : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type
  if (types.length && !types.some(matches)) throw new Error(`${path} 类型无效，须为 ${types.join(' / ')}`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 须为 ${schema.enum.join(' / ')}`)
  if (value === null) return
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)
      throw new Error(`${path} 范围须为 ${schema.minimum ?? '-∞'}～${schema.maximum ?? '∞'}`)
  }
  if (typeof value === 'string' && (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength))
    throw new Error(`${path} 字符长度须为 ${schema.minLength ?? 0}～${schema.maxLength ?? '不限'}`)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} 数量无效`)
    if (schema.items) value.forEach((item, i) => validateArguments(item, schema.items, `${path}[${i}]`))
  } else if (value && typeof value === 'object') {
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) throw new Error(`${path} 字段数量超过限制`)
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path} 缺少必填参数 ${key}`)
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validateArguments(item, schema.properties[key], `${path}.${key}`)
      else if (schema.additionalProperties === false) throw new Error(`${path} 不支持参数 ${key}`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateArguments(item, schema.additionalProperties, `${path}.${key}`)
    }
  }
}

// Existing text remains available to text-only clients. Every result additionally
// has an object representation: JSON objects, {items}, or {text} for reports.
export const RESULT_SCHEMA = { type: 'object', properties: {
  text: { type: 'string', description: '文本报告（没有专用 JSON 数据时）' },
  items: { type: 'array', items: {} },
  operation: { type: ['object', 'null'], description: '写入/付费 AI 调用的执行记录。id 可用于 get_operation；running/succeeded/failed/interrupted 不等于业务目标已全部完成；replayed 表示返回历史结果。', properties: {
    id: { type: 'string' }, tool: { type: 'string' }, status: { type: 'string', enum: ['running', 'succeeded', 'failed', 'interrupted'] },
    startedAt: { type: 'number' }, expiresAt: { type: 'number' }, replayed: { type: 'boolean' }, nextAction: { type: 'string' }
  }, required: ['id', 'tool', 'status', 'startedAt', 'expiresAt', 'nextAction'] },
  error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, nextAction: { type: 'string' } }, required: ['code', 'message', 'retryable', 'nextAction'] }
}, additionalProperties: true }
export function errorDetails(message: string, code?: string) {
  code ??= /已变化|已更新|别处更新|已改变/.test(message) ? 'STATE_CONFLICT'
    : /未接管|未连接|连接已断开/.test(message) ? 'AGENT_OWNERSHIP'
    : /正在编辑|仍在执行|请等待|仍在运行/.test(message) ? 'BUSY'
    : /不存在|找不到/.test(message) ? 'NOT_FOUND' : 'OPERATION_FAILED'
  return { code, message, retryable: ['STATE_CONFLICT', 'BUSY'].includes(code), nextAction:
    code === 'STATE_CONFLICT' ? '重新读取状态并核对用户改动后再决定下一步，勿原样重放。'
    : code === 'PERMISSION_DENIED' ? '在应用设置中检查权限；未执行操作。'
    : code === 'AGENT_OWNERSHIP' ? '重新连接并显式接管目标项目。'
    : code === 'INVALID_ARGUMENTS' ? '按工具 inputSchema 修正参数；未执行操作。'
    : code === 'BUSY' ? '等待当前操作完成后重新读取状态。' : '检查目标和当前状态后决定下一步。' }
}
