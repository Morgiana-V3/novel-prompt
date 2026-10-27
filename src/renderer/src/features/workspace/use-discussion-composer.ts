import type { PageMessage, PageVersion, PageWorkspace } from '@shared/workspace/model'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'
export function useDiscussionComposer(
  work: Ref<PageWorkspace>,
  current: ComputedRef<PageVersion>,
  discussionVersion: ComputedRef<PageVersion>,
  getPendingRequest: () => PageMessage | undefined,
  label: (id: string) => string,
  report: (message: string) => void,
  focusComposer: () => void,
) {
  const regionId = ref<string | null>(null)

  const region = computed(() =>
    current.value.editor.regions.find((region2) => region2.id === regionId.value),
  )

  const regionOptions = computed(() => [
    { value: null as string | null, label: '不附加区域批注' },
    ...current.value.editor.regions.map((region2) => ({
      value: region2.id,
      label: `区域 ${region2.label}${region2.instruction ? ` · ${region2.instruction.slice(0, 20)}` : ''}`,
    })),
  ])

  const references = ref<string[]>([])

  const composer = ref(work.value.composer)

  const discussionContext = computed(() => {
    const request = getPendingRequest()
    const versionId = request
      ? (request.discussion?.versionId ?? request.versionId)
      : discussionVersion.value.id
    const editVersionId = request?.versionId ?? current.value.id
    return {
      versionId,
      label: request?.discussion?.label ?? label(versionId),
      editVersionId,
      editLabel: label(editVersionId),
    }
  })

  function reference(id: string) {
    if (references.value.includes(id)) {
      references.value = references.value.filter((text) => text !== id)
    } else if (references.value.length < 2) {
      references.value.push(id)
    } else {
      report('一次最多引用两个版本，请先移除一个引用')
    }
    focusComposer()
  }
  return { regionId, region, regionOptions, references, composer, discussionContext, reference }
}
