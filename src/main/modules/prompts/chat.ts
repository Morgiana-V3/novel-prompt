import {
  AiServiceError,
  hasImages,
  requestChat,
  VisionUnsupportedError,
  type ChatInputMessage,
  type ChatMessage,
  type ChatOptions,
} from '../../providers/chat/client'
import { getSettings } from '../settings/service'
import type { PageSkillSnapshot } from '../../../shared/workspace/model'
import { modelVision, visionProvider } from '../../../shared/settings/vision'

/**
 * 带图对话走哪条路：main = 主模型看图；vision = 改走识图模型；text = 去掉图片只发文字。
 * 同一份 messages 的多轮请求保持同一条路，避免思考模式的多轮对话中途换模型。
 */
export type VisionRoute = 'main' | 'vision' | 'text'
interface RoutedChatOptions extends ChatOptions {
  /** Called after image removal/provider selection, before request serialization. */
  onRoute?: (route: VisionRoute | undefined) => void
}
const visionRoutes = new WeakMap<ChatInputMessage[], VisionRoute>()

/** 这份对话最终如何处理图片；没有图片时为 undefined */
export const visionRoute = (messages: ChatInputMessage[]) => visionRoutes.get(messages)

export const IMAGE_SKIPPED_NOTE =
  '当前模型不能识图，这次没有看到图片，只依据文字记录分析。可在「设置 → AI 服务 → 模型接口」配置识图模型。'

/** 原地把图片换成说明文字：后续轮次也不再带图，模型也知道自己没看到画面 */
function dropImages(messages: ChatInputMessage[]): void {
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue
    }
    let dropped = false
    message.content = message.content.flatMap((part) => {
      if (part.type !== 'image_url') {
        return [part]
      }
      if (dropped) {
        return []
      }
      dropped = true
      return [
        {
          type: 'text' as const,
          text: '【图片未发送：当前模型不能识图。不得声称看过画面，只能依据文字记录、批注和坐标分析，并在回复中说明这一点。】',
        },
      ]
    })
  }
}

/** 发送一轮请求；带图时按主模型和识图模型的能力分流，不能识图时降级为纯文字 */
async function send(
  messages: ChatInputMessage[],
  options: RoutedChatOptions,
): Promise<ChatMessage> {
  const settings = getSettings()
  const dispatch = (provider?: ChatOptions['provider']) => {
    options.onRoute?.(visionRoutes.get(messages))
    return requestChat(messages, settings, provider ? { ...options, provider } : options)
  }
  if (!hasImages(messages)) {
    return dispatch()
  }
  const vision = visionProvider(settings)
  const mainSupport = modelVision(settings.model)
  let route = visionRoutes.get(messages)
  if (!route) {
    if (vision && mainSupport !== 'yes') {
      route = 'vision'
    } else if (!vision && mainSupport === 'no') {
      route = 'text'
    } else {
      route = 'main'
    }
  }
  if (route === 'text') {
    dropImages(messages)
    visionRoutes.set(messages, route)
    return dispatch()
  }
  visionRoutes.set(messages, route)
  try {
    return await dispatch(route === 'vision' && vision ? vision : undefined)
  } catch (error) {
    if (!(error instanceof VisionUnsupportedError)) {
      throw error
    }
    if (route === 'vision') {
      throw new AiServiceError(
        `识图模型 ${error.model} 不支持图片输入，请在「设置 → AI 服务 → 模型接口」更换识图模型${error.detail ? `（服务端说明：${error.detail}）` : ''}`,
      )
    }
    if (vision) {
      visionRoutes.set(messages, 'vision')
      return dispatch(vision)
    }
    visionRoutes.set(messages, 'text')
    dropImages(messages)
    return dispatch()
  }
}

const readSessions = new WeakMap<ChatInputMessage[], { rounds: number; delivered: Set<string> }>()

export interface SkillReadActivity {
  requested: number
  loaded: number
  cached: number
}

export async function chat(
  messages: ChatInputMessage[],
  options: RoutedChatOptions & {
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
    return send(messages, options)
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
    const reply = await send(messages, { ...options, tools })
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
  return send(messages, options)
}
