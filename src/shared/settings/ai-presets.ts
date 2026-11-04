export type AiPreset = 'deepseek' | 'openai' | 'qwen' | 'glm' | 'kimi' | 'custom'

// Official Chat Completions base URLs, checked against vendor docs on 2026-11-02.
// Image input support per model lives in ./vision.ts (checked 2026-11-04).
// https://api-docs.deepseek.com/
// https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
// https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
// https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
// https://platform.kimi.com/docs/get-api-key
export const AI_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'openai',
    label: 'GPT（OpenAI）',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-sol',
    models: ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.4'],
  },
  {
    id: 'qwen',
    label: '通义千问（百炼·北京）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    // qwen3.5 以后的 Plus / Flash / Max 原生支持识图；旧别名 qwen-plus 未确认
    model: 'qwen3.7-plus',
    models: ['qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-max'],
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    // GLM-5.x 只接收文本；识图用 glm-5v-turbo
    models: ['glm-5.3', 'glm-5.2', 'glm-5v-turbo'],
  },
  {
    id: 'kimi',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'],
  },
  { id: 'custom', label: '自定义', baseUrl: '', model: '', models: [] },
] as const

export function inferAiPreset(baseUrl: string): AiPreset {
  const normalized = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (normalized === 'https://api.deepseek.com' || normalized === 'https://api.deepseek.com/v1') {
    return 'deepseek'
  }
  return AI_PRESETS.find((preset) => preset.baseUrl.toLowerCase() === normalized)?.id ?? 'custom'
}
