import { net } from 'electron'
import { getSettings } from '../settings'

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

interface ChatOptions {
  tools?: ToolDef[]
  json?: boolean
  temperature?: number
  /** 覆盖设置中的思考模式：false = 强制关闭 */
  thinking?: boolean
  signal?: AbortSignal
}

const isDeepSeek = (baseUrl: string, model: string) => /deepseek/i.test(baseUrl) || /^deepseek/i.test(model)

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatMessage> {
  const { apiKey, baseUrl, model, reasoningEffort } = getSettings()
  if (!apiKey) throw new Error('请先在设置中填写 DeepSeek API Key')
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const thinkingOn = opts.thinking !== false && reasoningEffort !== 'off'

  const body: Record<string, unknown> = { model, messages }
  if (isDeepSeek(baseUrl, model)) {
    body.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }
    if (thinkingOn) body.reasoning_effort = reasoningEffort
    // 思考模式下 temperature 会被忽略，仅非思考模式传入
    if (!thinkingOn) body.temperature = opts.temperature ?? 0.7
  } else {
    body.temperature = opts.temperature ?? 0.7
  }
  if (opts.tools?.length) body.tools = opts.tools
  if (opts.json) body.response_format = { type: 'json_object' }

  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal
  })
  if (!res.ok) throw new Error(`DeepSeek 请求失败 HTTP ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { choices: { message: ChatMessage }[] }
  const msg = data.choices?.[0]?.message
  if (!msg) throw new Error('DeepSeek 返回为空')
  const out: ChatMessage = { role: 'assistant', content: msg.content ?? null }
  if (msg.reasoning_content) out.reasoning_content = msg.reasoning_content
  if (msg.tool_calls?.length) out.tool_calls = msg.tool_calls
  return out
}

/** 从模型输出中提取 JSON 对象 */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const src = fenced ? fenced[1] : text
  const start = src.indexOf('{')
  const end = src.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('AI 输出中未找到 JSON')
  return JSON.parse(src.slice(start, end + 1)) as T
}
