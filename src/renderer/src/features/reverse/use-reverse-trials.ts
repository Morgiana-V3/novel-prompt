import { onBeforeUnmount, reactive } from 'vue'
import type { NaiGenRequest } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { imageState } from '../generation/state'
import { settingsState } from '../settings/state'
import { activeTask } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'

export interface ReverseTrial {
  id: number
  style: string
  request: NaiGenRequest
  state: 'pending' | 'generating' | 'scoring' | 'done' | 'error'
  image?: NaiImage
  score?: number
  error?: string
}

export function useReverseTrials() {
  const state = reactive({
    running: false,
    stopRequested: false,
    trials: [] as ReverseTrial[],
    previous: [] as ReverseTrial[],
    progress: '',
    error: '',
    cost: null as number | null,
  })
  let requesting = false

  function clear() {
    if (state.running) {
      return
    }
    state.trials = []
    state.previous = []
    state.progress = ''
    state.error = ''
    state.cost = null
  }

  async function run(
    candidates: { style: string; request: NaiGenRequest }[],
    reference?: number[],
  ) {
    if (state.running) {
      return
    }
    state.error = ''
    if (
      imageState.generating ||
      activeTask('generate') ||
      activeTask('inpaint') ||
      activeTask('page-generate')
    ) {
      state.error = '请等待当前生图任务完成'
      return
    }
    if (!settingsState.settings?.naiToken?.trim()) {
      state.error = '请先在「设置 / 数据」中填写 NovelAI API Token'
      return
    }
    if (!candidates.length || candidates.length > 6) {
      state.error = '请选择 1 到 6 个方案'
      return
    }
    // Every request is frozen before the first await, independently of every editor.
    const snapshots: typeof candidates = JSON.parse(JSON.stringify(candidates))
    const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0]
    for (const { request } of snapshots) {
      if (!request.base.trim() && !request.characters.some((role) => role.prompt.trim())) {
        state.error = '请先识别图片或填写基础提示词'
        return
      }
      const seed = request.params.seed
      request.params.seed = seed === null || (seed as unknown) === '' ? randomSeed : Number(seed)
      if (
        !Number.isInteger(request.params.seed) ||
        request.params.seed < 0 ||
        request.params.seed > 0xffffffff
      ) {
        state.error = '种子需留空或填写 0 到 4294967295 的整数'
        return
      }
      request.params.count = 1
    }
    const styleReference = reference ? [...reference] : undefined
    if (state.trials.some((trial) => trial.image)) {
      state.previous = state.trials
    }
    state.trials = snapshots.map((candidate, index) => ({
      ...candidate,
      id: index + 1,
      state: 'pending',
    }))
    state.running = true
    imageState.generating = true
    state.stopRequested = false
    state.cost = null
    let cost = 0
    let knownCost = true
    try {
      for (const [index, trial] of state.trials.entries()) {
        if (state.stopRequested) {
          break
        }
        trial.state = 'generating'
        state.progress = `正在生成 ${index + 1} / ${state.trials.length} · 种子 ${trial.request.params.seed}`
        try {
          requesting = true
          const result = await window.api
            .naiGenerate(JSON.parse(JSON.stringify(trial.request)))
            .finally(() => {
              requesting = false
            })
          if (result.anlasDelta === undefined) {
            knownCost = false
          } else {
            cost += result.anlasDelta
          }
          state.cost = knownCost ? cost : null
          if (!result.images.length) {
            throw new Error(result.stopped || '没有返回图片')
          }
          trial.image = result.images[0]
          trial.state = 'done'
          if (result.stopped) {
            throw new Error(result.stopped)
          }
          if (styleReference && !state.stopRequested) {
            trial.state = 'scoring'
            state.progress = `正在比较风格 ${index + 1} / ${state.trials.length}`
            try {
              trial.score = await window.api.reverseScore(styleReference, trial.image.name)
            } catch (error) {
              if (!state.stopRequested) {
                trial.error = `评分失败：${cleanErr(error)}`
              }
            } finally {
              trial.state = 'done'
            }
          }
        } catch (error) {
          trial.state = trial.image ? 'done' : 'error'
          trial.error = cleanErr(error)
          state.error = `${trial.error}；后续方案未生成`
          break
        }
      }
      const stopped = state.stopRequested || !!state.error
      state.progress = stopped ? '已停止，已完成图片保留' : '本轮完成'
    } finally {
      requesting = false
      state.running = false
      imageState.generating = false
    }
  }

  async function stop() {
    if (!state.running || state.stopRequested) {
      return
    }
    state.stopRequested = true
    state.progress = '正在停止，保留已完成图片…'
    try {
      if (requesting) {
        await window.api.naiCancel()
      } else if (state.trials.some((trial) => trial.state === 'scoring')) {
        await window.api.reverseCancel()
      }
    } catch (error) {
      state.error = `停止当前请求失败：${cleanErr(error)}；当前请求结束后不再提交后续方案`
    }
  }
  onBeforeUnmount(() => {
    state.stopRequested = true
  })
  return { state, run, stop, clear }
}
