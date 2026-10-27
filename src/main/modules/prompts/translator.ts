import type { UpdateProgress } from '../../../shared/tags/types'
import { CATEGORY_LABEL } from '../../../shared/tags/types'
import { extractJson } from '../../providers/chat/client'
import { tagStore } from '../tags/store'
import { chat } from './chat'

const BATCH = 150

export async function aiTranslate(
  minCount: number,
  onProgress: (progress: UpdateProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  const todo = tagStore.untranslated(minCount)
  let done = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    if (signal?.aborted) {
      break
    }
    const batch = todo.slice(i, i + BATCH)
    onProgress({
      stage: 'ai-translate',
      message: `AI 翻译中 ${i}/${todo.length}`,
      current: i,
      total: todo.length,
    })
    const list = batch.map((tag) => `${tag.name}\t${CATEGORY_LABEL[tag.category]}`).join('\n')
    const msg = await chat(
      [
        {
          role: 'system',
          content:
            '你是 Danbooru 标签翻译专家。把每个 tag 翻译成简洁准确的简体中文（2~10 字），符合二次元绘画圈常用叫法。角色/作品名用中文圈通行译名，不确定时音译或保留原名。输出 JSON：{"tag名":"中文", ...}，键必须与输入完全一致。',
        },
        { role: 'user', content: list },
      ],
      { json: true, temperature: 0.2, thinking: false, signal },
    )
    try {
      const map = extractJson<Record<string, string>>(msg.content ?? '')
      const valid: Record<string, string> = {}
      for (const tag of batch) {
        if (typeof map[tag.name] === 'string' && map[tag.name].trim()) {
          valid[tag.name] = map[tag.name].trim()
        }
      }
      tagStore.addAiTranslations(valid)
      done += Object.keys(valid).length
    } catch {
      /* 跳过本批 */
    }
  }
  tagStore.refreshTranslations()
  onProgress({ stage: 'done', message: `AI 翻译完成，共 ${done} 条` })
  return done
}
