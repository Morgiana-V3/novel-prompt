import {
  requestChat,
  type ChatInputMessage,
  type ChatMessage,
  type ChatOptions,
} from '../../providers/chat/client'
import { getSettings } from '../settings/service'
import type { PageSkillSnapshot } from '../../../shared/workspace/model'

export async function chat(
  messages: ChatInputMessage[],
  options: ChatOptions & { skillSnapshot?: PageSkillSnapshot } = {},
): Promise<ChatMessage> {
  const references =
    options.skillSnapshot?.sections?.filter((section) => section.resourcePath) ?? []
  if (!references.length) {
    return requestChat(messages, getSettings(), options)
  }
  const tools = [
    ...(options.tools ?? []),
    {
      type: 'function' as const,
      function: {
        name: 'read_skill_reference',
        description:
          '按 Skill 入口说明读取本轮冻结的 Markdown 参考资料。id 必须使用入口目录给出的完整读取标识。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
  ]
  for (let round = 0; round < 12; round++) {
    options.signal?.throwIfAborted()
    const reply = await requestChat(messages, getSettings(), { ...options, tools })
    const reads =
      reply.tool_calls?.filter((call) => call.function.name === 'read_skill_reference') ?? []
    if (!reads.length) {
      return reply
    }
    if (reads.length > 16) {
      throw new Error('本轮参考资料读取过多，请缩小任务范围')
    }
    const others = reply.tool_calls?.filter((call) => call.function.name !== 'read_skill_reference')
    messages.push({ ...reply, tool_calls: reads })
    for (const call of reads) {
      let content: string
      try {
        const input = JSON.parse(call.function.arguments) as { id?: unknown }
        const section = references.find((reference) => reference.id === input.id)
        if (!section) {
          throw new Error('资料不在本轮冻结目录中，请使用入口提供的读取标识')
        }
        content = options.skillSnapshot!.text.slice(section.start, section.end)
      } catch (error) {
        content = error instanceof Error ? error.message : String(error)
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
    if (others?.length) {
      return { ...reply, tool_calls: others }
    }
  }
  throw new Error('本轮参考资料读取次数过多，请检查 Skill 的引用说明')
}
