import {
  requestChat,
  type ChatInputMessage,
  type ChatMessage,
  type ChatOptions,
} from '../../providers/chat/client'
import { getSettings } from '../settings/service'
import type { PageSkillSnapshot } from '../../../shared/workspace/model'

const readSessions = new WeakMap<ChatInputMessage[], { rounds: number; delivered: Set<string> }>()

export interface SkillReadActivity {
  requested: number
  loaded: number
  cached: number
}

export async function chat(
  messages: ChatInputMessage[],
  options: ChatOptions & {
    skillSnapshot?: PageSkillSnapshot
    allowSkillReads?: boolean
    onRequest?: () => void
    onSkillRead?: (activity: SkillReadActivity) => void
  } = {},
): Promise<ChatMessage> {
  const references =
    options.skillSnapshot?.sections?.filter((section) => section.resourcePath) ?? []
  if (!references.length || options.allowSkillReads === false) {
    options.onRequest?.()
    return requestChat(messages, getSettings(), options)
  }
  const state = readSessions.get(messages) ?? { rounds: 0, delivered: new Set<string>() }
  readSessions.set(messages, state)
  const tools = [
    ...(options.tools ?? []),
    {
      type: 'function' as const,
      function: {
        name: 'read_skill_reference',
        description:
          '按 Skill 入口条件读取本轮冻结参考资料。优先一次用 ids 批量读取所需文件，避免逐份调用；已读正文仍在当前上下文时不重复读取。id/ids 必须使用入口目录的完整标识。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '读取单份资料' },
            ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 16,
              description: '一次读取多份相关资料',
            },
          },
          anyOf: [{ required: ['id'] }, { required: ['ids'] }],
          additionalProperties: false,
        },
      },
    },
  ]
  while (state.rounds < 8) {
    options.signal?.throwIfAborted()
    options.onRequest?.()
    const reply = await requestChat(messages, getSettings(), { ...options, tools })
    const reads =
      reply.tool_calls?.filter((call) => call.function.name === 'read_skill_reference') ?? []
    if (!reads.length) {
      return reply
    }
    state.rounds++
    const others = reply.tool_calls?.filter((call) => call.function.name !== 'read_skill_reference')
    messages.push({ ...reply, tool_calls: reads })
    const activity = { requested: 0, loaded: 0, cached: 0 }
    for (const call of reads) {
      let content: string
      try {
        const input = JSON.parse(call.function.arguments) as { id?: unknown; ids?: unknown }
        const ids = input.ids ?? [input.id]
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 16 ||
          ids.some((id) => typeof id !== 'string')
        ) {
          throw new Error('请传入单个 id，或包含 1–16 个完整读取标识的 ids 数组')
        }
        content = [...new Set(ids)]
          .map((id: string) => {
            activity.requested++
            const section = references.find((reference) => reference.id === id)
            if (!section) {
              return `${id}：资料不在本轮冻结目录中，请使用入口提供的完整读取标识`
            }
            if (state.delivered.has(id)) {
              activity.cached++
              return `${id}：正文已在本轮前面的工具消息中，请复用，不再重复加载。`
            }
            if (state.delivered.size >= 48) {
              return `${id}：本轮资料读取预算已用完，请依据已读取资料完成任务，明确未读部分。`
            }
            state.delivered.add(id)
            activity.loaded++
            const body = options.skillSnapshot!.text.slice(section.start, section.end)
            return input.ids ? `## ${id}\n${body}` : body
          })
          .join('\n\n')
      } catch (error) {
        content = error instanceof Error ? error.message : String(error)
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
    options.onSkillRead?.(activity)
    if (activity.cached > 0 && activity.loaded === 0) {
      state.rounds = 8
    }
    if (others?.length) {
      return { ...reply, tool_calls: others }
    }
  }
  messages.push({
    role: 'user',
    content:
      '参考资料读取阶段已结束。请基于已读取的正文继续当前任务，未读取或无法确认的内容明确说明；不要重复请求资料。',
  })
  options.onRequest?.()
  return requestChat(messages, getSettings(), options)
}
