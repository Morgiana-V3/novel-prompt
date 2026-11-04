import { PNG } from 'pngjs'
import { requestChat, VisionUnsupportedError } from '../../providers/chat/client'
import type { VisionProvider } from '../../../shared/settings/vision'
import type { VisionTestResult } from '../../../shared/settings/types'
import { getSettings } from '../settings/service'

/** 一张纯红色小图：能识图的模型会答「红」，接口悄悄丢图时模型只能瞎猜 */
function redSquare(): string {
  const png = new PNG({ width: 64, height: 64 })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 230
    png.data[i + 1] = 30
    png.data[i + 2] = 30
    png.data[i + 3] = 255
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

/** 用设置页当前填写的接口（可未保存）发一次带图请求，确认模型真的能看图 */
export async function testVision(provider: VisionProvider): Promise<VisionTestResult> {
  const model = provider?.model?.trim()
  const baseUrl = provider?.baseUrl?.trim()
  if (!model || !baseUrl) {
    return { ok: false, message: '请先填写接口地址和模型' }
  }
  try {
    const reply = await requestChat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图片是什么颜色？只回答一个颜色词。' },
            { type: 'image_url', image_url: { url: redSquare() } },
          ],
        },
      ],
      getSettings(),
      { provider: { apiKey: provider.apiKey?.trim() ?? '', baseUrl, model }, thinking: false },
    )
    const answer = (reply.content ?? '').trim().slice(0, 40)
    if (/红|red/i.test(answer)) {
      return { ok: true, message: `${model} 识图正常（回答：${answer}）` }
    }
    return {
      ok: false,
      message: `${model} 有回复，但没认出图片（回答：${answer || '空'}）。接口可能丢弃了图片，建议改用支持识图的模型`,
    }
  } catch (error) {
    if (error instanceof VisionUnsupportedError) {
      return { ok: false, message: `${model} 不支持图片输入` }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
