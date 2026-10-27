import { net } from 'electron'
import type { ReasoningEffort } from '../../../shared/settings/types'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** 思考模式的思维链；带 tools 的多轮调用必须原样回传 */
  reasoning_content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatOptions {
  provider?: { apiKey: string; baseUrl: string; model: string }
  tools?: ToolDef[]
  json?: boolean
  temperature?: number
  /** 覆盖设置中的思考模式：false = 强制关闭 */
  thinking?: boolean
  signal?: AbortSignal
}

const isDeepSeek = (baseUrl: string, model: string) =>
  /deepseek/i.test(baseUrl) || /^deepseek/i.test(model)

export type ChatPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type ChatInputMessage = Omit<ChatMessage, 'content'> & {
  content: string | null | ChatPart[]
}

export async function requestChat(
  messages: ChatInputMessage[],
  settings: { apiKey: string; baseUrl: string; model: string; reasoningEffort: ReasoningEffort },
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  const { reasoningEffort } = settings
  const { apiKey, baseUrl, model } = opts.provider ?? settings
  if (!apiKey) {
    throw new Error('请先在「设置 / 数据」中填写 AI 服务的 API Key')
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const thinkingOn = opts.thinking !== false && reasoningEffort !== 'off'

  const body: Record<string, unknown> = { model, messages }
  if (isDeepSeek(baseUrl, model)) {
    body.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }
    if (thinkingOn) {
      body.reasoning_effort = reasoningEffort
    }
    // 思考模式下 temperature 会被忽略，仅非思考模式传入
    if (!thinkingOn) {
      body.temperature = opts.temperature ?? 0.7
    }
  } else {
    body.temperature = opts.temperature ?? 0.7
  }
  if (opts.tools?.length) {
    body.tools = opts.tools
  }
  if (opts.json) {
    body.response_format = { type: 'json_object' }
  }

  // 单次请求的上限：网络卡住时不再无限显示「AI 思考中」。思考越深允许越久。
  const resolveLimitMs = () => {
    if (!thinkingOn) {
      return 120_000
    }
    if (reasoningEffort === 'low') {
      return 180_000
    }
    return 300_000
  }
  const limitMs = resolveLimitMs()
  const payload = JSON.stringify(body)
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(url, apiKey, payload, limitMs, opts.signal)
    } catch (error) {
      // 限流、服务繁忙、网络抖动可以稍后重试；Key 错误、参数错误、超时、用户取消不重试
      if (
        !(error instanceof AiServiceError) ||
        !error.retryable ||
        attempt >= RETRIES ||
        opts.signal?.aborted
      ) {
        throw error
      }
      await wait(error.retryAfterMs ?? 1500 * 2 ** attempt, opts.signal)
    }
  }
}

const RETRIES = 2

/** 可读的 AI 服务错误；retryable 表示稍后重试可能成功 */
export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'AiServiceError'
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.min(ms, 20_000))
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('已取消'))
      },
      { once: true },
    )
  })
}

/** 从响应体里取出服务端说明，截断并去掉可能回显的 Key */
function serverDetail(text: string, apiKey: string): string {
  let detail = text
  try {
    const errorBody = JSON.parse(text) as {
      error?: { message?: string } | string
      message?: string
    }
    detail =
      (typeof errorBody.error === 'string' ? errorBody.error : errorBody.error?.message) ??
      errorBody.message ??
      text
  } catch {
    /* 不是 JSON（如网关返回的 HTML），用原文 */
  }
  detail = detail
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (apiKey) {
    detail = detail.split(apiKey).join('***')
  }
  return detail.length > 300 ? detail.slice(0, 300) + '…' : detail
}

function httpError(status: number, detail: string, retryAfter: string | null): AiServiceError {
  const tail = detail ? `：${detail}` : ''
  const after = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined
  if (status === 401 || status === 403) {
    return new AiServiceError(
      `AI 服务拒绝了 API Key（HTTP ${status}），请在「设置 / 数据」检查 Key 是否正确、是否过期${tail}`,
    )
  }
  if (status === 402) {
    return new AiServiceError(`AI 服务账户余额不足（HTTP 402），请充值后重试${tail}`)
  }
  if (status === 404) {
    return new AiServiceError(
      `AI 服务找不到接口或模型（HTTP 404），请检查 Base URL 和模型名称${tail}`,
    )
  }
  if (status === 429) {
    return new AiServiceError(
      `AI 服务请求过于频繁（HTTP 429），已自动重试仍失败，请稍后再试${tail}`,
      true,
      after,
    )
  }
  if (status >= 500) {
    return new AiServiceError(
      `AI 服务暂时不可用（HTTP ${status}），已自动重试仍失败，请稍后再试${tail}`,
      true,
      after,
    )
  }
  return new AiServiceError(`AI 服务请求失败（HTTP ${status}）${tail}`)
}

async function requestOnce(
  url: string,
  apiKey: string,
  payload: string,
  limitMs: number,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const timeout = AbortSignal.timeout(limitMs)
  let res: Response
  try {
    res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: payload,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    if (timeout.aborted) {
      throw new AiServiceError(
        `AI 服务 ${Math.round(limitMs / 1000)} 秒内没有响应，可能是网络不稳定或服务繁忙；可稍后重试，或在设置中调低思考模式`,
      )
    }
    const raw = error instanceof Error ? error.message : String(error)
    if (/Failed to parse URL|Invalid URL/i.test(raw)) {
      throw new AiServiceError(`AI 服务地址无效，请检查「设置 / 数据」里的 Base URL：${url}`)
    }
    const resolveHint = () => {
      if (/NAME_NOT_RESOLVED/i.test(raw)) {
        return '域名无法解析，请检查 Base URL 或网络' as const
      }
      if (/PROXY|TUNNEL/i.test(raw)) {
        return '代理连接失败，请检查代理设置' as const
      }
      if (/CERT|SSL/i.test(raw)) {
        return '证书校验失败，可能被代理或安全软件拦截' as const
      }
      return '网络连接失败，请检查网络或代理' as const
    }
    const hint = resolveHint()
    throw new AiServiceError(`无法连接 AI 服务：${hint}（${raw.slice(0, 120)}）`, true)
  }
  if (!res.ok) {
    throw httpError(
      res.status,
      serverDetail(await res.text().catch(() => ''), apiKey),
      res.headers.get('retry-after'),
    )
  }
  const text = await res.text()
  let data: { choices?: { message?: ChatMessage }[] }
  try {
    data = JSON.parse(text)
  } catch {
    throw new AiServiceError(
      `AI 服务返回的不是有效数据，请检查 Base URL 是否指向 OpenAI 兼容接口：${serverDetail(text, apiKey).slice(0, 120)}`,
    )
  }
  const msg = data.choices?.[0]?.message
  if (!msg) {
    throw new AiServiceError('AI 服务返回为空，请稍后重试', true)
  }
  const out: ChatMessage = { role: 'assistant', content: msg.content ?? null }
  if (msg.reasoning_content) {
    out.reasoning_content = msg.reasoning_content
  }
  if (msg.tool_calls?.length) {
    out.tool_calls = msg.tool_calls
  }
  return out
}

/** 从模型输出中提取 JSON 对象 */
export function extractJson<T>(text: string): T {
  // A valid JSON reply can itself contain Markdown fences inside string values.
  try {
    return JSON.parse(text) as T
  } catch {
    /* Also accept prose/fenced wrappers below. */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  let error: unknown = new Error('AI 输出中未找到 JSON')
  for (const src of [text, ...(fenced ? [fenced[1]] : [])]) {
    const start = src.indexOf('{')
    const end = src.lastIndexOf('}')
    if (start < 0 || end < start) {
      continue
    }
    try {
      return JSON.parse(src.slice(start, end + 1)) as T
    } catch (error2) {
      error = error2
    }
  }
  throw error
}
