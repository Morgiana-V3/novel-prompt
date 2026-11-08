import { computed, reactive } from 'vue'
import type { NaiGenRequest } from '@shared/generation/types'
import { mixString, mixVariants, type ArtistMixPart } from '@shared/reverse/candidates'
import type { ReverseTrial } from './use-reverse-trials'

export type MixParts = Pick<ArtistMixPart, 'name' | 'weight'>[]
export type RoundKind = 'compare' | 'tune' | 'retry'

/** 画师对比一次最多张数；比例调优每轮张数与最多轮数 */
export const COMPARE_MAX = 6
export const TUNE_ROUND_SIZE = 4
export const TUNE_MAX_ROUNDS = 3
const FIRST_STEP = 0.15
/** 相似度提升小于它视为不再变好 */
const MIN_GAIN = 0.003

export interface MatchRound {
  kind: RoundKind
  label: string
  trials: ReverseTrial[]
  live?: boolean
}

interface TrialsState {
  running: boolean
  trials: ReverseTrial[]
  stopRequested: boolean
  error: string
  cost: number | null
}

/**
 * 匹配画风拆成两个问题：
 * - 对比画师（compare）：选中的画师各单独出一张，回答「该用哪几位画师」；
 * - 调优比例（tune）：只用选中画师的混合，逐轮试权重变体，回答「按什么比例混合最像」。
 *   变体只改权重、不增减成员（增减画师是「对比画师」的事）。
 * 各次结果按顺序保留、不互相覆盖；出图与 K3 打分复用试图流程。
 */
export function useStyleMatch(deps: {
  trials: TrialsState
  runCandidates: (candidates: { style: string; request: NaiGenRequest }[]) => Promise<void>
  buildCandidate: (style: string) => { style: string; request: NaiGenRequest }
  stop: () => Promise<void>
}) {
  const state = reactive({
    running: false,
    rounds: [] as MatchRound[],
    live: null as { kind: RoundKind; label: string } | null,
    message: '',
    /** 已知的额度消耗；任一次返回未知时为 null */
    spent: 0 as number | null,
  })
  /** 调优用到的组合（画师串 → 成员与权重），用来找回最佳结果的比例 */
  const partsByStyle = new Map<string, MixParts>()
  let cancelled = false

  /** 显示用：已完成的轮次 + 正在出图的这一轮 */
  const rounds = computed<MatchRound[]>(() =>
    state.live && deps.trials.running
      ? [...state.rounds, { ...state.live, trials: deps.trials.trials, live: true }]
      : state.rounds,
  )
  const imageCount = computed(
    () => rounds.value.flatMap((round) => round.trials).filter((trial) => trial.image).length,
  )
  function bestIn(kinds: RoundKind[]) {
    return rounds.value
      .filter((round) => kinds.includes(round.kind))
      .flatMap((round) => round.trials)
      .filter((trial) => trial.score !== undefined)
      .reduce<ReverseTrial | undefined>(
        (top, trial) => (!top || trial.score! > top.score! ? trial : top),
        undefined,
      )
  }
  /** 全场最像的一张（最佳配置卡片默认显示它） */
  const best = computed(() => bestIn(['compare', 'tune', 'retry']))
  /** 比例调优里最像的组合：混合组成跟随它更新 */
  const bestTune = computed(() => {
    const trial = bestIn(['tune'])
    const parts = trial ? partsByStyle.get(trial.style) : undefined
    return trial && parts ? { trial, parts } : undefined
  })

  function reset() {
    if (state.running) {
      return
    }
    state.rounds = []
    state.live = null
    state.message = ''
    state.spent = 0
    partsByStyle.clear()
  }

  async function runRound(
    kind: RoundKind,
    label: string,
    candidates: { style: string; request: NaiGenRequest }[],
  ) {
    state.live = { kind, label }
    await deps.runCandidates(candidates)
    state.live = null
    if (deps.trials.trials.length) {
      state.rounds.push({ kind, label, trials: [...deps.trials.trials] })
    }
    if (state.spent !== null) {
      state.spent = deps.trials.cost === null ? null : state.spent + deps.trials.cost
    }
  }
  function stoppedMessage() {
    return deps.trials.error ? `已停止：${deps.trials.error}` : '已停止'
  }
  function interrupted() {
    return cancelled || deps.trials.stopRequested || !!deps.trials.error
  }

  /** 对比画师：每位画师单独出一张 */
  async function compare(names: string[]) {
    const list = [...new Set(names)].slice(0, COMPARE_MAX)
    if (state.running || !list.length) {
      return
    }
    state.running = true
    cancelled = false
    try {
      state.message = `画师对比 · 出 ${list.length} 张`
      await runRound(
        'compare',
        '画师对比',
        list.map((name) => deps.buildCandidate(mixString([{ name, weight: 1 }]))),
      )
      state.message = interrupted() ? stoppedMessage() : '画师对比完成'
    } finally {
      state.live = null
      state.running = false
    }
  }

  /** 调优比例：从当前组合出发逐轮试权重变体，相似度不再提高或跑满轮数即结束 */
  async function tune(start: MixParts) {
    if (state.running || start.length < 2) {
      return
    }
    state.running = true
    cancelled = false
    const tried = new Set<string>()
    let center = start
    let step = FIRST_STEP
    let previousBest: number | undefined
    try {
      for (let round = 1; round <= TUNE_MAX_ROUNDS; round++) {
        // 只改权重：去掉「删掉最弱一位」这类改变成员的变体
        const variants = mixVariants(center, step, 12).filter(
          (parts) => parts.length === center.length,
        )
        const pool = round === 1 ? [start, ...variants] : variants
        const candidates = pool
          .filter((parts) => !tried.has(mixString(parts)))
          .slice(0, TUNE_ROUND_SIZE)
        if (!candidates.length) {
          state.message = '附近的比例都已试过，调优结束'
          break
        }
        for (const parts of candidates) {
          const key = mixString(parts)
          tried.add(key)
          partsByStyle.set(key, parts)
        }
        state.message = `比例调优 · 第 ${round} / ${TUNE_MAX_ROUNDS} 轮 · 出 ${candidates.length} 张`
        await runRound(
          'tune',
          `比例调优 ${round}`,
          candidates.map((parts) => deps.buildCandidate(mixString(parts))),
        )
        if (interrupted()) {
          state.message = stoppedMessage()
          break
        }
        const top = bestTune.value
        if (!top) {
          state.message = '没有得到风格相似度，无法调优（需要 K3 模型）'
          break
        }
        if (previousBest !== undefined && top.trial.score! < previousBest + MIN_GAIN) {
          state.message = `第 ${round} 轮没有更像的比例，调优结束`
          break
        }
        previousBest = top.trial.score
        state.message = round === TUNE_MAX_ROUNDS ? '比例调优完成' : `第 ${round} 轮完成，继续微调…`
        center = top.parts
        step = Math.max(0.05, step / 2)
      }
    } finally {
      state.live = null
      state.running = false
    }
  }

  /** 换种子再试：同样的配置随机种子再出一张，作为单独一组保留 */
  async function retry(trial: ReverseTrial) {
    if (state.running) {
      return
    }
    state.running = true
    cancelled = false
    try {
      state.message = '换种子再出一张…'
      await runRound('retry', '换种子', [
        {
          style: trial.style,
          request: { ...trial.request, params: { ...trial.request.params, seed: null } },
        },
      ])
      state.message = interrupted() ? stoppedMessage() : '换种子完成'
    } finally {
      state.live = null
      state.running = false
    }
  }

  async function cancel() {
    cancelled = true
    await deps.stop()
  }

  return { state, rounds, best, bestTune, imageCount, compare, tune, retry, cancel, reset }
}
