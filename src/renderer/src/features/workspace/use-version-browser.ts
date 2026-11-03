import type { PageWorkspace } from '@shared/workspace/model'
import {
  pageComparison,
  pageCurrent,
  pageGroups,
  pageImageToolLabel,
} from '@shared/workspace/model'
import type { Ref } from 'vue'
import { displayVersionLabel } from './labels'
import { computed, ref } from 'vue'
export function useVersionBrowser(work: Ref<PageWorkspace>) {
  const current = computed(() => pageCurrent(work.value))

  const viewedId = ref(work.value.currentVersionId)

  const viewed = computed(
    () => work.value.versions.find((version) => version.id === viewedId.value) ?? current.value,
  )

  const groups = computed(() => pageGroups(work.value).slice().reverse())

  const viewedGroup = computed(() =>
    groups.value.find((versionGroup) =>
      versionGroup.versions.some((version) => version.id === viewed.value.id),
    )!,
  )

  const viewedCandidates = computed(() =>
    viewedGroup.value.versions.filter((version) => !version.imageCleared),
  )

  const groupCards = computed(() => {
    const hasGenerated = work.value.versions.some((version) => version.generated)
    // Keep the initial draft for discussion references and comparisons, but once
    // images exist the visible history starts at V1, not an empty starting card.
    return groups.value
      .filter(
        (group) =>
          !hasGenerated ||
          group.versions.some(
            (version) =>
              version.image || version.generated || version.parentId || version.imageCleared,
          ),
      )
      .map((versionGroup) => ({
        ...versionGroup,
        cover:
          versionGroup.versions.find((version) => version.id === viewedId.value) ??
          versionGroup.versions.find((version) => version.id === current.value.id) ??
          versionGroup.versions[versionGroup.versions.length - 1],
        adopted: versionGroup.versions.some((version) => version.id === current.value.id),
      }))
  })

  const historical = computed(() => viewed.value.id !== current.value.id)

  const compareOptions = computed(() => [
    { value: '', label: '生成来源' },
    ...work.value.versions
      .filter(
        (version) => version.id !== viewed.value.id && (version.generated || !version.parentId),
      )
      .slice()
      .reverse()
      .map((version) => ({ value: version.id, label: displayVersionLabel(version.label) })),
  ])

  const reviewVersionId = computed(() => viewed.value.id)

  const compareVersionId = ref('')

  const comparison = computed(() =>
    pageComparison(work.value, viewed.value.id, compareVersionId.value),
  )

  const selectedProposalId = ref<string | null>(null)

  const discussionVersion = viewed

  const label = (id: string) =>
    displayVersionLabel(
      work.value.versions.find((version) => version.id === id)?.label ?? '历史版本',
    )

  function shortVersion(id: string) {
    const version = work.value.versions.find((version2) => version2.id === id)
    if (!version) {
      return '历史'
    }
    if (version.groupId) {
      return displayVersionLabel(version.label)
    }
    const index = work.value.versions.indexOf(version)
    if (index === 0) {
      if (version.image) {
        return '原稿' as const
      }
      return '起点' as const
    }
    return `版本 ${index}`
  }

  function versionDetail(version: PageWorkspace['versions'][number]) {
    const resolveValue = () => {
      if (version.generated?.tool) {
        return pageImageToolLabel(version.generated.tool)
      }
      if (version.generated) {
        return `${version.generated.execution.kind === 'inpaint' ? '局部重绘' : '提示词生成'} · 种子 ${version.generated.params.seed}`
      }
      return '' as const
    }
    return [
      displayVersionLabel(version.label),
      version.parentId ? `来源：${label(version.parentId)}` : '',
      resolveValue(),
    ]
      .filter(Boolean)
      .join('\n')
  }
  return {
    current,
    viewedId,
    viewed,
    groups,
    viewedGroup,
    viewedCandidates,
    groupCards,
    historical,
    compareOptions,
    reviewVersionId,
    compareVersionId,
    comparison,
    selectedProposalId,
    discussionVersion,
    label,
    shortVersion,
    versionDetail,
  }
}
