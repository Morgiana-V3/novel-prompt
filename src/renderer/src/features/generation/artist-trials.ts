import { reactive } from 'vue'
import type { NaiGenRequest, NaiGenResult } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { cleanErr } from '../../shared/lib/format'

export interface ArtistTrial {
  id: number
  style: string
  selected: boolean
  state: 'pending' | 'generating' | 'scoring' | 'done' | 'error'
  image?: NaiImage
  request?: NaiGenRequest
  score?: number
  error?: string
}

export const artistTrials = reactive({
  active: false,
  running: false,
  stopRequested: false,
  referenceUrl: '',
  reference: undefined as number[] | undefined,
  draft: undefined as NaiGenRequest | undefined,
  scoreEnabled: true,
  trials: [] as ArtistTrial[],
  progress: '',
  cost: null as number | null,
})

export function stageArtistTrials(
  styles: string[],
  draft: NaiGenRequest,
  reference?: number[],
  image?: Blob,
) {
  if (artistTrials.running) {
    throw new Error('请先停止当前试图')
  }
  URL.revokeObjectURL(artistTrials.referenceUrl)
  Object.assign(artistTrials, {
    active: true,
    stopRequested: false,
    referenceUrl: image ? URL.createObjectURL(image) : '',
    reference: reference ? [...reference] : undefined,
    draft: JSON.parse(JSON.stringify(draft)),
    scoreEnabled: !!reference,
    trials: styles.map((style, index) => ({
      id: index + 1,
      style,
      selected: true,
      state: 'pending',
    })),
    progress: '',
    cost: null,
  })
}

/** One frozen request and seed per round. Scoring failure never regenerates an image. */
export async function runArtistTrials(
  request: NaiGenRequest,
  onResult: (result: NaiGenResult) => Promise<void>,
) {
  const queue = artistTrials.trials
    .filter((trial) => trial.selected && trial.state === 'pending')
    .map((trial) => ({ trial, style: trial.style.trim() }))
  if (!queue.length || queue.length > 6) {
    throw new Error('请选择 1 到 6 个待生成方案')
  }
  if (new Set(queue.map((item) => item.style)).size !== queue.length) {
    throw new Error('选中的画师串有重复，请修改或取消勾选')
  }
  const snapshot: NaiGenRequest = JSON.parse(JSON.stringify(request))
  if (snapshot.params.seed === null) {
    snapshot.params.seed = crypto.getRandomValues(new Uint32Array(1))[0]
  }
  const seed = snapshot.params.seed
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('种子需为 0 到 4294967295 的整数')
  }
  snapshot.params.count = 1
  artistTrials.draft = JSON.parse(JSON.stringify(snapshot))
  const reference = artistTrials.reference ? [...artistTrials.reference] : undefined
  const shouldScore = artistTrials.scoreEnabled && !!reference
  const images: NaiImage[] = []
  let knownCost = true
  let cost = 0
  artistTrials.running = true
  artistTrials.stopRequested = false
  artistTrials.cost = null
  try {
    for (const [index, { trial, style }] of queue.entries()) {
      if (artistTrials.stopRequested) {
        break
      }
      trial.state = 'generating'
      trial.error = undefined
      artistTrials.progress = `正在生成 ${index + 1} / ${queue.length} · 种子 ${seed}`
      trial.request = {
        ...snapshot,
        base: [style, snapshot.base.trim()].filter(Boolean).join(', '),
      }
      try {
        const result = await window.api.naiGenerate(JSON.parse(JSON.stringify(trial.request)))
        if (result.anlasDelta === undefined) {
          knownCost = false
        } else {
          cost += result.anlasDelta
        }
        artistTrials.cost = knownCost ? cost : null
        if (!result.images.length) {
          throw new Error(result.stopped || '没有返回图片')
        }
        trial.image = result.images[0]
        trial.state = 'done'
        images.push(...result.images)
        await onResult({ ...result, images: [...images], anlasDelta: knownCost ? cost : undefined })
        if (shouldScore && !artistTrials.stopRequested) {
          trial.state = 'scoring'
          artistTrials.progress = `正在比较风格 ${index + 1} / ${queue.length}`
          try {
            trial.score = await window.api.reverseScore(reference!, trial.image.name)
          } catch (error) {
            trial.error = `评分失败：${cleanErr(error)}`
          } finally {
            trial.state = 'done'
          }
        }
        if (result.stopped) {
          throw new Error(result.stopped)
        }
      } catch (error) {
        trial.state = trial.image ? 'done' : 'error'
        trial.error = cleanErr(error)
        artistTrials.progress = '已停止，未生成的方案保留'
        throw new Error(`${trial.error}；后续方案未生成`)
      }
    }
    artistTrials.progress = artistTrials.stopRequested ? '已停止，未生成的方案保留' : '本轮结束'
  } finally {
    artistTrials.running = false
  }
}
