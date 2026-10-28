import type { ChatInputMessage, ToolCall } from '../../providers/chat/client'

/** One discussion's read-only lookups: bounded concurrency, budget and duplicate suppression. */
export class ReadOnlyToolSession {
  readonly stats = { requested: 0, executed: 0, cached: 0, limited: 0 }
  private cache = new Map<string, { id: string; result: Promise<string> }>()

  constructor(
    private readonly execute: (
      name: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<string>,
    private readonly allowed: Set<string>,
    private readonly limit = 48,
  ) {}

  async run(calls: ToolCall[], signal?: AbortSignal): Promise<ChatInputMessage[]> {
    this.stats.requested += calls.length
    const results: ChatInputMessage[] = new Array(calls.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < calls.length) {
        signal?.throwIfAborted()
        const index = cursor++
        const call = calls[index]
        let content: string
        try {
          if (!this.allowed.has(call.function.name)) {
            throw new Error('本轮不支持该工具，请使用已提供的查询工具')
          }
          const args = JSON.parse(call.function.arguments || '{}')
          if (!args || typeof args !== 'object' || Array.isArray(args)) {
            throw new Error('参数须为 JSON 对象')
          }
          const key =
            call.function.name +
            ':' +
            JSON.stringify(
              Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))),
            )
          const cached = this.cache.get(key)
          if (cached) {
            this.stats.cached++
            await cached.result
            content = `相同查询已执行，结果见本轮工具消息 ${cached.id}。请复用已有结果，不要重复查询。`
          } else if (this.stats.executed >= this.limit) {
            this.stats.limited++
            content =
              '本轮查询预算已用完；请用已有结果整理方案，明确未核实项，不要继续查询或编造依据。'
          } else {
            this.stats.executed++
            const result = Promise.resolve()
              .then(() => this.execute(call.function.name, args, signal))
              .catch((error: unknown) => {
                signal?.throwIfAborted()
                return '工具未完成：' + (error instanceof Error ? error.message : String(error))
              })
            this.cache.set(key, { id: call.id, result })
            content = await result
          }
        } catch (error) {
          signal?.throwIfAborted()
          content = '工具未完成：' + (error instanceof Error ? error.message : String(error))
        }
        results[index] = { role: 'tool', tool_call_id: call.id, content }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, calls.length) }, worker))
    return results
  }
}
