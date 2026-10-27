import type { NaiGenParams, NaiGenResult, NaiVersion } from '@shared/generation/types'
import type { InpaintDraft } from '@shared/prompts/types'

interface InpaintQueue {
  sourceImage: string
  queue: { label: string; mask: string; draft: InpaintDraft }[]
  params: NaiGenParams
  version: NaiVersion
  strength: number
  shouldStop: () => boolean
  report: (message: string) => void
  failed: (message: string) => void
  generated: (response: NaiGenResult, draft: InpaintDraft) => void
}

/** Each completed region becomes the next source; cancellation never discards completed images. */
export async function executeInpaintQueue(options: InpaintQueue): Promise<void> {
  let imageName = options.sourceImage
  for (let index = 0; index < options.queue.length; index++) {
    if (options.shouldStop()) {
      options.report(`已停止后续重绘，完成 ${index}/${options.queue.length} 个区域，已有结果保留。`)
      break
    }
    const region = options.queue[index]
    options.report(`正在重绘${region.label}（${index + 1}/${options.queue.length}）…`)
    const response = await window.api.naiInpaint({
      ...region.draft,
      params: options.params,
      version: options.version,
      inpaint: { imageName, mask: region.mask, strength: options.strength },
    })
    options.generated(response, region.draft)
    if (!response.images.length) {
      options.failed(response.stopped ?? '没有收到重绘结果，队列已停止')
      break
    }
    imageName = response.images[response.images.length - 1].name
    options.report(
      response.stopped ??
        `已完成 ${index + 1}/${options.queue.length} 个区域，重绘结果已另存到图库。`,
    )
    if (response.stopped) {
      break
    }
  }
}
