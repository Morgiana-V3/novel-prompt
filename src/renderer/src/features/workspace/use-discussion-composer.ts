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
  const selectedRegionIds = ref<string[]>([])

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
  return { regionId, selectedRegionIds, references, composer, discussionContext, reference }
}
