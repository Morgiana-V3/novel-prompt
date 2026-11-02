import type { NaiVersion } from '../../../shared/generation/types'
import type { AiPreviewRequest, AiPreviewResult } from '../../../shared/prompts/types'
import { extractJson, type ChatMessage } from '../../providers/chat/client'
import { composeSkills } from '../skills/service'
import { chat } from './chat'
import { normalizePreview } from './preview-response'
import { localReview, userPrompt } from './preview-review'
export { reviewPrompt } from './preview-review'
const MAX_RETRY = 1
function systemPrompt(version: NaiVersion, skillText: string, forecastOnly = false): string {
  const modelName = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  return `${skillText}

---
# 程序约定（优先于所有 Skill）
- 你的任务是根据提示词推测成图效果（不是优化提示词）。用户消息里的「本地解析」是程序对每个 tag 的真实查询结果，以它为准。
- 未看到成图时，正负面冲突只说明压制倾向，不保证某元素消失或变成特定颜色；high 只表示输入依据明确。未提供的细节保持不确定，不能将自己的推断写成引用资料已经证明的机制。
- 必须结合生成参数中的质量词和 UC 预设判断实际输入；关闭的预设没有效果，开启的隐式词与手写词共同生效。注意 no text 与文字、screentone / halftone 与网点、multiple views 与多格画面的潜在冲突。仅推测模式只描述影响和风险，不提供改写或开关建议。
- 目标模型：**${modelName}**
- 只输出一个 JSON 对象（不要多余文字），confidence 取值 high / medium / low，risks.level 取值 high / medium / low，basis 取值 rule（可被程序校验的硬规则）/ data（统计数据）/ doc（依据启用的 Skill 或官方文档，evidence 写出 Skill 名称）/ taste（审美判断）：
{"summary":"整体画面描述","confidence":"整体置信度","style":{"text":"画风与上色","tags":["关键 tag"],"confidence":"medium"},"composition":{"text":"构图、镜头、景别","tags":[],"confidence":"medium"},"scene":{"text":"背景与场景","tags":[],"confidence":"medium"},"lighting":{"text":"光影与色调","tags":[],"confidence":"medium"},"characters":[{"name":"角色称呼，如 角色 1 / 主角","position":"在画面中的位置，可空","text":"外貌、服装、表情、动作","tags":[],"confidence":"high"}],"emphasis":[{"tag":"被强调的 tag","effect":"会带来的效果"}],"suppressed":[{"tag":"负面中的 tag","effect":"被压制或推开的效果"}],"risks":[{"level":"medium","text":"风险说明","tags":["相关 tag"],"basis":"data","evidence":"依据"}],"gap":"与想要效果的差距，未提供期望则为空字符串","suggestions":[{"text":"具体修改建议","basis":"rule","evidence":"依据"}]}
- 全部用简体中文输出；tag 原样引用英文。
- 没有角色提示词但画面里有人物时，characters 仍按画面里的人物逐个描述。
${forecastOnly ? '- 本次仅推测当前提示词可能生成的画面。描述构图、人物、场景、光影、强调与压制效果及不确定性，不评价如何改写，不提出修改建议，不推断作者另有期望。所有描述字段都遵循这一限制；gap 必须为空字符串，suggestions 必须为空数组。' : ''}`
}

/* ---------- 结果规整 ---------- */

export async function previewPrompt(
  req: AiPreviewRequest,
  onStep: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiPreviewResult> {
  onStep('本地解析提示词…')
  const { sections, issues, tagCount, ev } = await localReview(req, onStep, signal)
  onStep(`共 ${tagCount} 个正向元素，本地发现 ${issues.length} 个问题`)

  const skills = composeSkills('preview', req.version)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.version, skills.text, req.forecastOnly) },
    { role: 'user', content: userPrompt(req, sections, issues, ev.block) },
  ]

  for (let i = 0; i <= MAX_RETRY; i++) {
    onStep(i ? 'AI 重新整理输出格式…' : 'AI 正在想象画面…')
    const msg = await chat(messages, {
      json: true,
      skillSnapshot: skills.snapshot,
      temperature: 0.5,
      signal,
    })
    try {
      const result = normalizePreview(extractJson<Record<string, unknown>>(msg.content ?? ''))
      if (!result.summary) {
        throw new Error('empty')
      }
      onStep('完成')
      return {
        ...result,
        ...(req.forecastOnly ? { gap: '', suggestions: [] } : {}),
        issues,
        tagCount,
        evidence: ev.info,
      }
    } catch {
      messages.push(
        { role: 'assistant', content: msg.content ?? '' },
        { role: 'user', content: '请只输出约定格式的 JSON 对象。' },
      )
    }
  }
  throw new Error('AI 未返回有效结果，请重试')
}
