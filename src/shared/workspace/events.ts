import type { PageMessage } from './model'

export interface PageEventBilling {
  /** Observed balance delta, not a provider-issued per-request receipt. */
  /** not-run means no generation service was called; unknown never implies zero cost. */
  status: 'known' | 'unknown' | 'not-run'
  anlasDelta?: number
  usageDelta?: number
  remainingAnlas?: number
}

interface PageEventBase {
  schema: 1
  severity: 'info' | 'warning' | 'error'
}

export interface PageExecutionEvent extends PageEventBase {
  type: 'execution'
  kind: 'generate' | 'inpaint' | 'upscale' | 'outpaint' | 'enhance'
  sourceVersionId: string
  versionIds: string[]
  adoptedVersionId: string
  requestedCount: number
  /** Image completion is independent of billing verification and stop conditions. */
  status: 'complete' | 'partial' | 'failed'
  stopped: string | null
  billing: PageEventBilling
  error?: string
}

export interface PageExecutionObservation {
  messageId: string
  observedAt: number
  event: PageExecutionEvent
}

/** The recorded adopted version belongs to this event, never to today's mutable workspace. */
export function latestPageExecution(messages: PageMessage[]): PageExecutionObservation | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'event' && message.event?.type === 'execution') {
      return { messageId: message.id, observedAt: message.createdAt, event: message.event }
    }
  }
  return null
}

export type PageEventMetadata =
  | PageExecutionEvent
  | (PageEventBase & {
      type: 'proposal'
      messageId: string
      title: string
      decision: 'accepted' | 'rejected' | 'withdrawn'
    })
  | (PageEventBase & { type: 'goal'; goal: string; preserve: string })
  | (PageEventBase & { type: 'agent'; mode: 'internal' | 'external'; name?: string })
  | (PageEventBase & { type: 'request-cancelled'; requestId: string })
  | (PageEventBase & {
      /** Read-time classification only; legacy records are never rewritten. */
      type: 'legacy'
      category:
        'execution' | 'billing' | 'proposal' | 'goal' | 'agent' | 'version' | 'state' | 'error'
      billing?: PageEventBilling
    })

const numberPattern = '(?:0|[1-9]\\d*)(?:\\.\\d+)?'
const legacyBillingPattern = new RegExp(
  `^(Anlas 变化未知|余额未变（0 Anlas）|余额(减少|增加) (${numberPattern}) Anlas)` +
    `(?: · V5 免费额度(减少|增加) (${numberPattern}) 个百分点)?` +
    `(?: · 剩余 (${numberPattern}) Anlas)?$`,
)

function legacyBilling(text: string): PageEventBilling | null {
  const match = legacyBillingPattern.exec(text)
  if (!match || match[0] !== text) {
    return null
  }
  const billing: PageEventBilling = {
    status: match[1] === 'Anlas 变化未知' ? 'unknown' : 'known',
  }
  if (billing.status === 'known') {
    billing.anlasDelta = match[3] ? Number(match[3]) * (match[2] === '减少' ? -1 : 1) : 0
  }
  if (match[5]) {
    billing.usageDelta = Number(match[5]) * (match[4] === '减少' ? -1 : 1)
  }
  if (match[6]) {
    billing.remainingAnlas = Number(match[6])
  }
  return billing
}

/** Unknown legacy text remains visible; never classify by an Anlas substring. */
export function pageEventMetadata(message: PageMessage): PageEventMetadata | null {
  if (message.role !== 'event') {
    return null
  }
  if (message.event) {
    if (message.error && message.event.severity !== 'error') {
      return { ...message.event, severity: 'error' }
    }
    return message.event
  }
  const legacy = (
    category: Extract<PageEventMetadata, { type: 'legacy' }>['category'],
    severity: PageEventBase['severity'] = 'info',
  ): PageEventMetadata => ({ schema: 1, type: 'legacy', category, severity })
  if (message.error) {
    return legacy('error', 'error')
  }
  const billing = legacyBilling(message.text)
  if (billing) {
    return {
      schema: 1,
      type: 'legacy',
      category: 'billing',
      severity: billing.status === 'unknown' ? 'warning' : 'info',
      billing,
    }
  }
  if (
    message.text === '无法读取 Anlas 余额，无法确认是否扣费，已停止后续生成' ||
    message.text === '生成后查询余额失败，无法确认是否扣费，已停止后续生成'
  ) {
    return {
      schema: 1,
      type: 'legacy',
      category: 'billing',
      severity: 'warning',
      billing: { status: 'unknown' },
    }
  }
  if (
    message.text === '已停止，已完成的图片已保留' ||
    message.text === '已取消' ||
    /^已取消，完成了 [1-9]\d* 张$/.test(message.text) ||
    /^检测到扣除了 Anlas（订阅 -?\d+(?:\.\d+)?、购买 -?\d+(?:\.\d+)?），已停止后续生成$/.test(
      message.text,
    ) ||
    /^不满足免费条件，已停止：[^\r\n]+$/.test(message.text)
  ) {
    return legacy('state', 'warning')
  }
  if (/^第 [1-9]\d* 张失败：[^\r\n]+$/.test(message.text)) {
    return legacy('error', 'error')
  }
  if (
    /^从「[^「」\r\n]+」(?:按提示词生成|局部重绘 [^。\r\n]+|放大 2×|扩图 · [^。\r\n]+|(?:精修|增强) · [^。\r\n]+)，得到「方案 V\d+ · 候选 \d+」。(?:首张结果已设为创作(?:蓝本|底稿)。|已保存，当前(?:蓝本|底稿)未改变。)$/.test(
      message.text,
    )
  ) {
    return legacy('execution')
  }
  if (
    /^(?:本次重绘|放大 2×|扩图 · [^\r\n]+|(?:精修|增强) · [^\r\n]+)未完成：[\s\S]+。当前版本未替换。$/.test(
      message.text,
    ) ||
    /^本轮未完成：[\s\S]+$/.test(message.text)
  ) {
    return legacy('error', 'error')
  }
  if (
    /^(?:未采纳建议「[^「」\r\n]+」，提示词和图片未改变。|已采纳「[^「」\r\n]+」，已更新当前提示词草稿，尚未生成图片。|撤销了建议「[^「」\r\n]+」，恢复采纳前的提示词。)$/.test(
      message.text,
    )
  ) {
    return legacy('proposal')
  }
  if (/^目标：[^\r\n]*(?:\n保留：[^\r\n]*)?$/.test(message.text)) {
    return legacy('goal')
  }
  if (
    /^已交给外部 Agent「[^「」\r\n]+」处理；不会调用内置 AI。$/.test(message.text) ||
    message.text === '已切换外部 Agent，等待连接；需求会保存在本会话。' ||
    message.text === '已切换为内置 AI；待处理的外部需求已取消。'
  ) {
    return legacy('agent')
  }
  if (
    /^创作(?:蓝本|底稿)切换为「[^「」\r\n]+」。之后从此版本继续，其他结果保留为历史。$/.test(
      message.text,
    ) ||
    /^已恢复「[^「」\r\n]+」的原始图片。$/.test(message.text)
  ) {
    return legacy('version')
  }
  if (
    message.text === '会话已建立。' ||
    message.text === '会话已建立，已读取原图提示词。' ||
    message.text === '已加载收藏配方，替换提示词、模型和生成设置，清除旧选区；尚未生成图片。'
  ) {
    return legacy('state')
  }
  return null
}

/** Execution, warnings and unknown text always remain available in the main timeline. */
export function isRoutinePageEvent(message: PageMessage): boolean {
  const event = pageEventMetadata(message)
  if (!event || event.severity !== 'info' || event.type === 'execution') {
    return false
  }
  if (event.type === 'legacy') {
    if (event.category === 'execution' || event.category === 'version') {
      return false
    }
    if (event.category === 'billing') {
      return event.billing?.status === 'known' && event.billing.anlasDelta === 0
    }
  }
  return true
}
