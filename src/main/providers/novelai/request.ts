import { net } from 'electron'

/**
 * NovelAI 图像接口（https://image.novelai.net）。
 * 文生图与局部重绘：每次请求 1 张，多张时串行请求。
 * Token 只放在请求头，任何错误信息里都不会带出 Token。
 */

export const HOST = 'https://image.novelai.net'

export const TIMEOUT = 180_000

export class NaiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export async function errorMessage(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const errorBody = JSON.parse(text) as { message?: string; error?: string }
      detail = errorBody.message ?? errorBody.error ?? text
    } catch {
      detail = text
    }
  } catch {
    /* ignore */
  }
  detail = detail.replace(/pst-[\w-]+/g, 'pst-***').slice(0, 300)
  const statusCode = res.status
  const resolveHead = () => {
    if (statusCode === 400 || statusCode === 422) {
      return '请求参数不被接受' as const
    }
    if (statusCode === 401 || statusCode === 403) {
      return 'Token 无效或没有权限，请检查设置里的 NovelAI Token' as const
    }
    if (statusCode === 402) {
      return '余额不足或当前会员不支持该请求' as const
    }
    if (statusCode === 429) {
      return '请求太频繁，被限流了，请稍等再试' as const
    }
    if (statusCode >= 500) {
      return '服务端出错，结果不确定：重试前请先看看图库和 Anlas 余额，避免重复生成' as const
    }
    return '请求失败' as const
  }
  const head = resolveHead()
  return `${head}（HTTP ${statusCode}）${detail ? `：${detail}` : ''}`
}

export async function request(
  path: string,
  init: RequestInit,
  accept: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT)
  let res: Response
  try {
    res = await net.fetch(`${HOST}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: accept,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    const name = (error as Error)?.name
    if (name === 'TimeoutError') {
      throw new NaiError(
        '请求超时：服务端可能已经在生成，重试前请先确认图库和 Anlas 余额，避免重复扣费',
      )
    }
    if (name === 'AbortError') {
      throw new NaiError('已取消')
    }
    throw new NaiError(
      `网络错误：${String((error as Error)?.message ?? error).replace(/pst-[\w-]+/g, 'pst-***')}`,
    )
  }
  if (!res.ok) {
    throw new NaiError(await errorMessage(res), res.status)
  }
  return res
}
