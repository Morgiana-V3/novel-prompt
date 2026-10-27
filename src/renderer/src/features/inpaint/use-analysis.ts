import { computed, ref, type Ref } from 'vue'
import type { AiInpaintRequest, AiInpaintResult, InpaintDraft } from '@shared/prompts/types'
import { applyInpaintChanges } from '@shared/prompts/inpaint-plan'
import { cleanErr } from '../../shared/lib/format'
import type { Region } from './model'

interface AnalysisHost {
  annotations: () => Region[]
  regions: Ref<Region[]>
  draft: InpaintDraft
  canAnalyze: () => boolean
  canAdopt: () => boolean
  isAlive: () => boolean
  isOpened: () => boolean
  request: (draft: InpaintDraft, regions: Region[]) => AiInpaintRequest
  beforeAnalyze: () => void
  beforeAdopt: () => void
  showSuggestions: () => void
  error: Ref<string>
  status: Ref<string>
}

export function useInpaintAnalysis(host: AnalysisHost) {
  const analyzing = ref(false)
  const analysisInfo = ref<AiInpaintResult | null>(null)
  let analysisDraft: InpaintDraft | null = null
  const analyzable = computed(() =>
    host.annotations().filter((region) => region.hasPixels && region.instruction.trim()),
  )

  function resetAnalysis() {
    analysisInfo.value = null
    analysisDraft = null
  }

  async function analyzeRegions() {
    if (!host.canAnalyze() || analyzing.value) {
      return
    }
    const annotated = analyzable.value
    if (!annotated.length) {
      host.error.value = '请先涂选区域并填写修改批注'
      return
    }
    host.beforeAnalyze()
    host.error.value = ''
    analyzing.value = true
    const snapshot: InpaintDraft = JSON.parse(JSON.stringify(host.draft))
    try {
      const response = await window.api.planInpaint(host.request(snapshot, annotated))
      if (!host.isAlive() || !host.isOpened()) {
        return
      }
      analysisDraft = snapshot
      analysisInfo.value = response
      for (const region of annotated) {
        region.plan = response.plans.find((plan) => plan.id === region.id) ?? null
        region.checked = region.plan?.changes.map(() => true) ?? []
        region.accepted = null
      }
      host.showSuggestions()
    } catch (error) {
      if (host.isAlive()) {
        host.error.value = cleanErr(error)
      }
    } finally {
      analyzing.value = false
    }
  }

  function adopt(region: Region) {
    if (
      !region.plan ||
      !analysisDraft ||
      analyzing.value ||
      !host.canAdopt() ||
      !region.checked.some(Boolean)
    ) {
      return
    }
    host.beforeAdopt()
    try {
      region.accepted = applyInpaintChanges(
        host.draft,
        region.plan.changes.filter((_, index) => region.checked[index]),
      )
      host.status.value = `区域 ${region.label} 已采纳，可在「提示词」中继续编辑；尚未生成图片。`
    } catch (error) {
      host.error.value = cleanErr(error)
    }
  }

  function adoptAll() {
    host.regions.value.filter((region) => region.plan?.changes.length).forEach(adopt)
  }

  const cancelAnalysis = () => window.api.cancelInpaintPlan()
  return {
    analyzing,
    analysisInfo,
    analyzable,
    resetAnalysis,
    analyzeRegions,
    adopt,
    adoptAll,
    cancelAnalysis,
  }
}
