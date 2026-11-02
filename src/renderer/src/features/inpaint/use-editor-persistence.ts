import { markRaw, nextTick, watch, type Ref } from 'vue'
import type { NaiGenParams } from '@shared/generation/types'
import type { InpaintDraft } from '@shared/prompts/types'
import type { PageEditorState } from '@shared/workspace/model'
import { cleanErr } from '../../shared/lib/format'
import type { Region, Stroke } from './model'
interface EditorPersistenceHost {
  settings: NaiGenParams & { strength: number }
  draft: InpaintDraft
  width: Ref<number>
  height: Ref<number>
  regions: Ref<Region[]>
  loading: Ref<boolean>
  sourceUrl: Ref<string>
  active: Ref<Stroke | null>
  frontendBusy: Ref<boolean>
  error: Ref<string>
  usedLabels: Set<string>
  selectedId: Ref<string>
  promptNote: Ref<string>
  panel: Ref<'regions' | 'suggestions' | 'prompt'>
  exportMask: (region: Region) => string
  makeRegion: () => Region
  renderMask: () => void
  measureMask: () => void
  nextRegionNumber: () => number
  props: {
    saveEditor?: (snapshot: PageEditorState) => Promise<void>
    initialRegionId?: string | null
  }
}
const cloneDraft = (draft: InpaintDraft): InpaintDraft => JSON.parse(JSON.stringify(draft))
/** Owns snapshot scheduling, serialized saves and restoration for one editor. */
export function useEditorPersistence(host: EditorPersistenceHost) {
  const {
    settings,
    draft,
    width,
    height,
    regions,
    loading,
    sourceUrl,
    active,
    frontendBusy,
    error,
    usedLabels,
    selectedId,
    promptNote,
    panel,
    exportMask,
    makeRegion,
    renderMask,
    measureMask,
    props,
  } = host
  let savingSnapshot: Promise<void> | null = null
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  function editorSnapshot(): PageEditorState {
    const { strength, ...params } = settings
    return {
      draft: cloneDraft(draft),
      params: {
        ...params,
        width: width.value,
        height: height.value,
        seed: params.seed === null || (params.seed as unknown) === '' ? null : Number(params.seed),
      },
      strength,
      regions: regions.value
        .filter((region) => region.hasPixels)
        .map((region) => ({
          id: region.id,
          label: region.label,
          instruction: region.instruction,
          target: region.target,
          anchor: region.anchor ? { ...region.anchor } : null,
          annotated: region.annotated,
          mask: exportMask(region),
          accepted: region.accepted ? cloneDraft(region.accepted) : null,
        })),
    }
  }
  async function persistEditor() {
    if (!props.saveEditor || loading.value || !sourceUrl.value || active.value) {
      return
    }
    if (savingSnapshot) {
      await savingSnapshot
    }
    const request = props.saveEditor(editorSnapshot())
    savingSnapshot = request
    try {
      await request
    } finally {
      if (savingSnapshot === request) {
        savingSnapshot = null
      }
    }
  }
  watch(
    [regions, draft, settings],
    () => {
      if (!props.saveEditor || loading.value || frontendBusy.value) {
        return
      }
      clearTimeout(snapshotTimer)
      snapshotTimer = setTimeout(() => {
        void persistEditor().catch((candidate) => {
          error.value = `选区保存失败：${cleanErr(candidate)}`
        })
      }, 800)
    },
    { deep: true },
  )
  async function restoreEditor(saved: PageEditorState) {
    Object.assign(draft, cloneDraft(saved.draft))
    Object.assign(settings, saved.params, { strength: saved.strength })
    await nextTick() // Let draft invalidation finish before restoring accepted suggestions.
    const restored: Region[] = []
    for (const item of saved.regions) {
      const img = new Image()
      img.src = `data:image/png;base64,${item.mask}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width.value
      canvas.height = height.value
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, width.value, height.value)
      for (let i = 0; i < pixels.data.length; i += 4) {
        const a = pixels.data[i]
        pixels.data.set([255, 107, 154, a], i)
      }
      ctx.putImageData(pixels, 0, 0)
      usedLabels.add(item.label)
      restored.push({
        ...makeRegion(),
        ...item,
        number: item.annotated ? host.nextRegionNumber() : 0,
        baseMask: markRaw(canvas),
        strokes: [],
        hasPixels: true,
      })
    }
    regions.value = restored.length ? restored : [makeRegion()]
    selectedId.value =
      regions.value.find((region) => region.id === props.initialRegionId)?.id ?? regions.value[0].id
    promptNote.value = '已恢复当前版本的提示词、选区和批注。'
    renderMask()
    measureMask()
    panel.value = 'regions'
  }

  const cancelPendingSave = () => clearTimeout(snapshotTimer)
  return { persistEditor, restoreEditor, cancelPendingSave }
}
